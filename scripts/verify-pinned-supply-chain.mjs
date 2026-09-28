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
