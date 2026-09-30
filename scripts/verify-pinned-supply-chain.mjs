import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_REF = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /@sha256:[0-9a-f]{64}$/i;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'dist', 'coverage', '.expo', 'build']);

function finding(path, line, rule, message) {
  return { path, line, rule, message };
}

function cleanValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/[,;]$/, '').replace(/\\$/, '').trim();
}

function isImageReference(value) {
  const image = cleanValue(value);
  return image === 'scratch'
    || image.startsWith('docker://')
    || /^(?:ghcr\.io|docker\.io|quay\.io|gcr\.io|registry\.[^/]+|returntocorp)\//i.test(image)
    || /^[^/\s]+\.[^/\s]+\//.test(image)
    || /^[^/\s]+\/[^/\s]+(?::[^/\s]+)?(?:@sha256:[0-9a-f]{64})?$/i.test(image)
    || /^(?:node|caddy|alpine|busybox|postgres|redis|semgrep|zaproxy):/i.test(image);
}

function imageFinding(path, line, value, kind) {
  const image = cleanValue(value);
  if (!image || image === 'scratch' || SHA256_DIGEST.test(image)) return null;
  return finding(
    path,
    line,
    'image-digest-required',
    `operator-required: resolve ${image} to an immutable sha256 digest (${kind}); do not guess.`,
  );
}

function actionFinding(path, line, value) {
  const action = cleanValue(value);
  if (action.startsWith('./') || action.startsWith('.')) return null;
  const separator = action.lastIndexOf('@');
  const ref = separator === -1 ? '' : action.slice(separator + 1);
  if (COMMIT_REF.test(ref)) return null;
  return finding(
    path,
    line,
    'action-ref-not-immutable',
    `operator-required: resolve ${action} to a reviewed 40-character commit SHA; do not guess.`,
  );
}

function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function parseJson(text) {
  return JSON.parse(stripJsonComments(text).replace(/,\s*([}\]])/g, '$1'));
}

function nextStepLine(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*-\s+/.test(lines[index])) return index;
  }
  return lines.length;
}

export function analyzeWorkflow(path, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const findings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const uses = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/i);
    if (uses) {
      const actionFindingResult = actionFinding(path, index + 1, uses[1]);
      if (actionFindingResult) findings.push(actionFindingResult);
      if (/^actions\/checkout@/i.test(uses[1])) {
        const block = lines.slice(index + 1, nextStepLine(lines, index));
        if (!block.some((entry) => !/^\s*#/.test(entry) && /\bpersist-credentials\s*:\s*false\b/i.test(entry))) {
          findings.push(finding(
            path,
            index + 1,
            'checkout-persist-credentials-required',
            'set persist-credentials: false on every actions/checkout step.',
          ));
        }
      }
    }

    const image = line.match(/^\s*(?:image|container\s*:\s*image)\s*:\s*([^#]+)/i);
    if (image) {
      const imageFindingResult = imageFinding(path, index + 1, image[1], 'workflow image');
      if (imageFindingResult) findings.push(imageFindingResult);
    }

    if (/\bdeno\b/.test(line)) {
      if (/(?:^|\s)--no-lock(?:\s|$)/.test(line)) {
        findings.push(finding(path, index + 1, 'deno-no-lock', 'remove Deno --no-lock from verification; commit and use the resolved lockfile.'));
      }
      if (/(?:^|\s)--no-check(?:\s|$)/.test(line)) {
        findings.push(finding(path, index + 1, 'deno-no-check', 'remove Deno --no-check from verification; type-check locked sources.'));
      }
    }
  }

  const logicalLines = [];
  let buffer = '';
  let startLine = 1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (!buffer) startLine = index + 1;
    if (line.trimEnd().endsWith('\\')) {
      buffer += `${line.trimEnd().slice(0, -1)} `;
      continue;
    }
    logicalLines.push({ line: startLine, text: `${buffer}${line}` });
    buffer = '';
  }
  if (buffer) logicalLines.push({ line: startLine, text: buffer });

  for (const command of logicalLines) {
    if (/\bdeno\b/.test(command.text)) {
      if (/(?:^|\s)--no-lock(?:\s|$)/.test(command.text)) {
        findings.push(finding(path, command.line, 'deno-no-lock', 'remove Deno --no-lock from verification; commit and use the resolved lockfile.'));
      }
      if (/(?:^|\s)--no-check(?:\s|$)/.test(command.text)) {
        findings.push(finding(path, command.line, 'deno-no-check', 'remove Deno --no-check from verification; type-check locked sources.'));
      }
    }

    const npx = command.text.match(/\bnpx\b([^;\n]*)/i);
    if (npx) {
      const tokens = npx[1].trim().split(/\s+/).filter(Boolean);
      let packageName = '';
      let sawYes = false;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index].replace(/^['"]|['"],?$/g, '');
        if (token === '--yes' || token === '-y') {
          sawYes = true;
          continue;
        }
        if (token.startsWith('-')) {
          if (token === '--package' && tokens[index + 1]) index += 1;
          continue;
        }
        packageName = token;
        break;
      }
      const separator = packageName.lastIndexOf('@');
      const version = separator > 0 ? packageName.slice(separator + 1) : '';
      if (sawYes) {
        findings.push(finding(
          path,
          command.line,
          'npx-yes-forbidden',
          'remove npx --yes; use a lockfile-backed or exact package runner instead.',
        ));
      }
      if (!EXACT_VERSION.test(version)) {
        findings.push(finding(
          path,
          command.line,
          'npx-tool-unpinned',
          `operator-required: ${sawYes ? 'npx --yes ' : 'npx '}tool ${packageName || '<missing>'} must use an exact version; do not guess.`,
        ));
      }
    }

    const docker = command.text.match(/\bdocker\s+(?:run|pull)\b([\s\S]*)/i);
    if (docker) {
      let skipVolumeValue = false;
      for (const token of docker[1].split(/\s+/)) {
        const candidate = cleanValue(token);
        if (candidate === '-v' || candidate === '--volume') {
          skipVolumeValue = true;
          continue;
        }
        if (skipVolumeValue) {
          skipVolumeValue = false;
          continue;
        }
        if (isImageReference(candidate) && !candidate.startsWith('-')) {
          const imageFindingResult = imageFinding(path, command.line, candidate, 'docker image');
          if (imageFindingResult) findings.push(imageFindingResult);
        }
      }
    }
  }

  if (/^\s*deno\b/mi.test(text) && !/^\s*(?:run:\s*)?deno\s+check\b/mi.test(text)) {
    const line = lines.findIndex((entry) => /\bdeno\b/.test(entry)) + 1;
    findings.push(finding(
      path,
      Math.max(line, 1),
      'deno-check-required',
      'add a Deno check command for the locked Edge Function sources.',
    ));
  }

  const unique = new Map(findings.map((item) => [`${item.path}:${item.line}:${item.rule}`, item]));
  return [...unique.values()].sort((left, right) =>
    left.line - right.line || left.rule.localeCompare(right.rule));
}

export function analyzeDockerfile(path, text) {
  const findings = [];
  const stages = new Set();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const syntax = line.match(/^\s*#\s*syntax\s*=\s*(\S+)/i);
    if (syntax) {
      const result = imageFinding(path, index + 1, syntax[1], 'Dockerfile syntax frontend');
      if (result) findings.push(result);
    }
    const from = line.match(/^\s*FROM(?:\s+--[^\s]+)?\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      if (!stages.has(from[1].toLowerCase())) {
        const result = imageFinding(path, index + 1, from[1], 'Dockerfile base image');
        if (result) findings.push(result);
      }
      if (from[2]) stages.add(from[2].toLowerCase());
    }
  }
  return findings;
}

export function analyzeCompose(path, text) {
  const findings = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const image = lines[index].match(/^\s*image\s*:\s*([^#]+)/i);
    if (!image) continue;
    const result = imageFinding(path, index + 1, image[1], 'Compose image');
    if (result) findings.push(result);
  }
  return findings;
}

export function analyzeDenoConfig(path, text, { baseDirectory = ROOT } = {}) {
  let config;
  try {
    config = parseJson(text);
  } catch (error) {
    return [finding(path, 1, 'deno-config-invalid', `Deno config is not valid JSON: ${error.message}`)];
  }
  const findings = [];
  if (config.lock === false) {
    findings.push(finding(path, 1, 'deno-lock-disabled', 'operator-required: enable and commit a Deno lockfile; do not disable lock verification.'));
    return findings;
  }
  const lock = config.lock === true ? 'deno.lock' : config.lock;
  if (typeof lock !== 'string' || !lock) {
    findings.push(finding(path, 1, 'deno-lock-required', 'operator-required: set lock to a committed Deno lockfile path.'));
    return findings;
  }
  const lockPath = isAbsolute(path)
    ? resolve(dirname(path), lock)
    : resolve(baseDirectory, dirname(path), lock);
  if (!existsSync(lockPath)) {
    findings.push(finding(path, 1, 'deno-lock-missing', `operator-required: generate ${lock} with the installed Deno toolchain and commit it.`));
  }
  return findings;
}

function importMapFinding(path, line, value) {
  const clean = cleanValue(value);
  if (!clean) return finding(path, line, 'deno-import-unpinned', 'operator-required: remove the empty Deno import or replace it with a pinned URL.');
  if (/[?&]no-check(?:=|&|$)/i.test(clean)) {
    return finding(path, line, 'deno-import-no-check', 'remove no-check from the Deno import map; verification must type-check locked sources.');
  }
  if (clean.startsWith('jsr:')) {
    const version = clean.slice(4).split('/')[1]?.split('@')[1] ?? '';
    if (!EXACT_VERSION.test(version)) {
      return finding(path, line, 'deno-import-unpinned', `operator-required: pin ${clean} to an exact JSR version; do not guess.`);
    }
    return null;
  }
  if (!/^https?:\/\//i.test(clean)) return null;
  if (/\b(?:latest|next|main|master)\b/i.test(clean) || /[\^~*]/.test(clean.slice(clean.indexOf('@') + 1).split(/[?#]/)[0])) {
    return finding(path, line, 'deno-import-unpinned', `operator-required: pin ${clean} to an exact Deno dependency version; do not guess.`);
  }
  const versionMatch = clean.match(/@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:[/?#]|$)/);
  if (!versionMatch) {
    return finding(path, line, 'deno-import-unpinned', `operator-required: pin ${clean} to an exact Deno dependency version; do not guess.`);
  }
  return null;
}

export function analyzeImportMap(path, text) {
  let config;
  try {
    config = parseJson(text);
  } catch (error) {
    return [finding(path, 1, 'deno-import-map-invalid', `Deno import map is not valid JSON: ${error.message}`)];
  }
  const findings = [];
  for (const [name, value] of Object.entries(config.imports ?? {})) {
    const line = text.split(/\r?\n/).findIndex((entry) => entry.includes(`"${name}"`)) + 1;
    const result = importMapFinding(path, Math.max(line, 1), value);
    if (result) findings.push(result);
  }
  return findings;
}

function walk(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) walk(root, fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function isWorkflow(filePath) {
  return filePath.includes(`${sep}.github${sep}workflows${sep}`)
    && ['.yml', '.yaml'].includes(extname(filePath));
}

function isDockerfile(filePath) {
  return basename(filePath).toLowerCase().startsWith('dockerfile');
}

function isCompose(filePath) {
  return /(?:^|[-_])(?:docker-)?compose(?:\.[^.]+)?\.ya?ml$/i.test(basename(filePath))
    || /^docker-compose(?:\.[^.]+)?\.ya?ml$/i.test(basename(filePath));
}

function isDenoConfig(filePath) {
  return basename(filePath).toLowerCase() === 'deno.json' || basename(filePath).toLowerCase() === 'deno.jsonc';
}

function isImportMap(filePath) {
  return basename(filePath).toLowerCase() === 'import_map.json';
}

// ---------------------------------------------------------------------------
// npm transitive pins (.pnpmfile.cjs against pnpm-lock.yaml)
// ---------------------------------------------------------------------------
//
// The pnpmfile is the repo's declared supply-chain control for transitive npm
// dependencies: `pnpm audit` findings are answered by pinning a package to its
// patched version inside readPackage. A pin that the lockfile does not
// actually resolve is a control that reads as present and is not, so the two
// files are compared mechanically rather than by review.
//
// Two scopes, because the two kinds of rule mean different things:
//
//   range   the rule rewrites a range of the dependency's own versions
//           (fast-uri 3.x -> 3.1.8). Nothing else in the tree may resolve that
//           package at any other version, so every version in the lockfile has
//           to be one of the declared targets.
//   parent  the rule only rewrites what one named parent asks for
//           (postcss, for next and @sentry/*). Another parent may legitimately
//           resolve a different version, so the check is only that at least one
//           declared target was reached.
//
// The scope is read from the enclosing guard rather than assumed: a rule is
// parent-scoped if and only if some block it sits inside tests `pkg.name`.
const PNPMFILE = '.pnpmfile.cjs';
const LOCKFILE = 'pnpm-lock.yaml';
const PIN_ASSIGNMENT = /^\s*pkg\.(?:dependencies|optionalDependencies)\s*(?:\[\s*'([^']+)'\s*\]|\.(\w+))\s*=\s*'([^']+)'\s*;?\s*$/;
const PIN_LOOP_ASSIGNMENT = /^\s*pkg\.(?:dependencies|optionalDependencies)\s*\[\s*(\w+)\s*\]\s*=\s*'([^']+)'\s*;?\s*$/;

/** Indentation of a line, counting a tab as one column. */
function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

/**
 * The block openers enclosing the line at `index`, outermost last.
 *
 * Walks outward by indentation rather than taking the nearest opener, so a rule
 * nested inside both `if (pkg.dependencies) {` and `if (pkg.name === 'next') {`
 * is attributed to the parent check rather than to the dependency check.
 */
function enclosingOpeners(lines, index) {
  const openers = [];
  let ceiling = indentOf(lines[index]);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    if (!line.trimEnd().endsWith('{')) continue;
    const indent = indentOf(line);
    if (indent >= ceiling) continue;
    openers.push(line);
    ceiling = indent;
    if (ceiling === 0) break;
  }
  return openers;
}

function addPin(pins, key, pin) {
  const existing = pins.get(key);
  if (!existing) {
    pins.set(key, { ...pin, versions: [...pin.versions] });
    return;
  }
  if (existing.scope !== pin.scope) {
    // A rule guarded on the parent is the narrower statement, so the pin is
    // only claimed for the parents it names.
    existing.scope = 'parent';
  }
  for (const version of pin.versions) {
    if (!existing.versions.includes(version)) existing.versions.push(version);
  }
}

/**
 * Every pin the pnpmfile declares.
 *
 * Both spellings are read: the quoted index form, the dotted form, and the loop
 * form where the package name comes from a guard's regular expression.
 */
export function parsePnpmfilePinAssignments(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const pins = new Map();
  const unattributed = [];

  for (let index = 0; index < lines.length; index += 1) {
    const literal = PIN_ASSIGNMENT.exec(lines[index]);
    const loop = literal ? null : PIN_LOOP_ASSIGNMENT.exec(lines[index]);
    if (!literal && !loop) continue;

    const openers = enclosingOpeners(lines, index);
    const scope = openers.some((line) => /pkg\.name\b/.test(line)) ? 'parent' : 'range';
    const version = literal ? literal[3] : loop[2];

    if (literal) {
      const name = literal[1] ?? literal[2];
      addPin(pins, name, { name, versions: [version], scope, line: index + 1 });
      continue;
    }

    // Loop form: the package name is whatever the guard's pattern accepts.
    const pattern = openers
      .flatMap((line) => [...line.matchAll(/\/\^([^/]+?)\$\/\s*\.test\(\s*(\w+)\s*\)/g)])
      .find((match) => match[2] === loop[1]);
    if (!pattern) {
      unattributed.push({ line: index + 1, expression: lines[index].trim() });
      continue;
    }
    addPin(pins, `pattern:${pattern[1]}`, {
      name: null,
      namePattern: pattern[1],
      versions: [version],
      scope,
      line: index + 1,
    });
  }

  return {
    pins: [...pins.values()].sort((left, right) =>
      (left.name ?? left.namePattern).localeCompare(right.name ?? right.namePattern)),
    unattributed,
  };
}

export function parsePnpmfilePins(text) {
  return parsePnpmfilePinAssignments(text).pins;
}

/**
 * Every `name@version` the lockfile resolved, as name -> versions.
 *
 * Both the `packages` and `snapshots` sections are read because a peer-suffixed
 * snapshot key carries the same name/version pair, and reading only one of them
 * would make the answer depend on which section a package happened to land in.
 */
export function lockfilePackageVersions(text) {
  const versions = new Map();
  if (typeof text !== 'string') return versions;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  for (const line of lines) {
    if (/^(packages|snapshots):\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (/^[A-Za-z]/.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    // Two spaces exactly: a package key sits at that indent and its resolution
    // block below is deeper, so nothing nested can be mistaken for a package.
    const key = /^ {2}(\S+):(?:\s|$)/.exec(line);
    if (!key) continue;
    const name = key[1].replace(/^['"]|['"]$/g, '').split('(')[0];
    const separator = name.lastIndexOf('@');
    if (separator <= 0) continue;
    const packageName = name.slice(0, separator);
    const version = name.slice(separator + 1);
    if (!versions.has(packageName)) versions.set(packageName, new Set());
    versions.get(packageName).add(version);
  }
  return versions;
}

export function analyzeNpmPins({ pnpmfileText, lockfileText, pnpmfilePath = PNPMFILE, lockfilePath = LOCKFILE } = {}) {
  if (pnpmfileText === undefined) return [];
  const { pins, unattributed } = parsePnpmfilePinAssignments(pnpmfileText);

  const findings = [];
  for (const item of unattributed) {
    findings.push(finding(
      pnpmfilePath,
      item.line,
      'npm-pin-unattributed',
      `operator-required: ${item.expression} names no package this checker can resolve, so the pin is unverified; pin it by name.`,
    ));
  }
  if (typeof lockfileText !== 'string') {
    findings.push(finding(
      lockfilePath,
      1,
      'npm-pin-lock-missing',
      `operator-required: commit ${lockfilePath}; an npm pin that no lockfile resolves is not a control.`,
    ));
    return findings;
  }

  const versions = lockfilePackageVersions(lockfileText);
  for (const pin of pins) {
    const label = pin.name ?? `/${pin.namePattern}/`;
    const matched = pin.name
      ? (versions.has(pin.name) ? [[pin.name, versions.get(pin.name)]] : [])
      : [...versions.entries()].filter(([name]) => new RegExp(`^${pin.namePattern}$`).test(name));
    if (matched.length === 0) continue;

    for (const [name, resolved] of matched) {
      const reached = pin.versions.filter((version) => resolved.has(version));
      if (reached.length === 0) {
        // The rule never took effect for this package: the lockfile holds a
        // version the pin does not name, so the control reads as present and is
        // not. One finding, not one per resolved version.
        findings.push(finding(
          lockfilePath,
          1,
          'npm-pin-not-in-lock',
          `operator-required: ${pnpmfilePath} pins ${name} to ${pin.versions.join(', ')} (${label}); the lockfile resolved ${[...resolved].sort().join(', ')}. Re-resolve the lockfile.`,
        ));
        continue;
      }
      if (pin.scope !== 'range') continue;
      const unpinned = [...resolved].filter((version) => !pin.versions.includes(version)).sort();
      if (unpinned.length === 0) continue;
      findings.push(finding(
        lockfilePath,
        1,
        'npm-pin-version-drift',
        `operator-required: ${name} is pinned to ${pin.versions.join(', ')} but the lockfile also resolved ${unpinned.join(', ')}; the rule is not reaching every requester.`,
      ));
    }
  }

  return findings;
}

function relativePath(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
}

export function scanRepository({ root = ROOT } = {}) {
  const findings = [];
  const files = walk(root);
  for (const filePath of files) {
    const path = relativePath(root, filePath);
    let text;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      findings.push(finding(path, 1, 'file-unreadable', `operator-required: make ${path} readable for supply-chain verification: ${error.message}`));
      continue;
    }
    if (isWorkflow(filePath)) findings.push(...analyzeWorkflow(path, text));
    if (isDockerfile(filePath)) findings.push(...analyzeDockerfile(path, text));
    if (isCompose(filePath)) findings.push(...analyzeCompose(path, text));
    if (isDenoConfig(filePath)) findings.push(...analyzeDenoConfig(path, text, { baseDirectory: root }));
    if (isImportMap(filePath)) findings.push(...analyzeImportMap(path, text));
  }

  // The npm transitive pins are not per-file: they are one pnpmfile against one
  // lockfile, so they are compared once over the whole repository.
  const pnpmfile = join(root, PNPMFILE);
  const lockfile = join(root, LOCKFILE);
  if (existsSync(pnpmfile)) {
    findings.push(...analyzeNpmPins({
      pnpmfileText: readFileSync(pnpmfile, 'utf8'),
      lockfileText: existsSync(lockfile) ? readFileSync(lockfile, 'utf8') : null,
    }));
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule));
  return { failed: findings.length > 0, findings };
}

function main() {
  const result = scanRepository();
  if (result.failed) {
    for (const item of result.findings) console.error(`${item.path}:${item.line}:${item.rule}: ${item.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('pinned-supply-chain-pass');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
