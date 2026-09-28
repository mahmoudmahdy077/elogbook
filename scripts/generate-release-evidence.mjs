#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTPUT = 'docs/upgrade/evidence/release';

export const REQUIRED_INPUTS = Object.freeze([
  { kind: 'pnpm-lock', path: 'pnpm-lock.yaml' },
  { kind: 'dockerfile', path: 'apps/web/Dockerfile' },
  { kind: 'deno-config', path: 'supabase/functions/payment-webhook/deno.json' },
  { kind: 'deno-lock', path: 'supabase/functions/payment-webhook/deno.lock' },
  { kind: 'mobile-eas', path: 'apps/mobile/eas.json' },
]);

export class EvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvidenceError';
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function unquote(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function readInput(root, definition) {
  const absolute = resolve(root, definition.path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new EvidenceError(`required evidence input missing: ${definition.path}`);
  }
  const bytes = readFileSync(absolute);
  return {
    kind: definition.kind,
    path: definition.path.split(sep).join('/'),
    sha256: sha256(bytes),
    bytes: bytes.length,
    text: bytes.toString('utf8'),
  };
}

function parseJson(input, label) {
  try {
    return JSON.parse(input.text);
  } catch (error) {
    throw new EvidenceError(`${label} is not valid JSON: ${error.message}`);
  }
}

function sectionLines(text, heading) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${heading}:\\s*(?:#.*)?$`, 'i').test(line));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function splitPackageKey(value) {
  const key = unquote(value);
  const separator = key.lastIndexOf('@');
  if (separator <= 0) return null;
  const name = key.slice(0, separator);
  const version = key.slice(separator + 1).split('(')[0];
  if (!name || !version) return null;
  return { name, version };
}

function npmPurl(name, version) {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function component({ type, name, version, reference, purl, properties = [] }) {
  const result = {
    type,
    name,
    version,
    'bom-ref': reference,
  };
  if (purl) result.purl = purl;
  if (properties.length > 0) result.properties = properties.sort((left, right) => left.name.localeCompare(right.name));
  return result;
}

function pnpmComponents(input) {
  const components = [];
  const seen = new Set();
  for (const line of sectionLines(input.text, 'packages')) {
    const match = line.match(/^\s{2}['"]?(.+?)['"]?:\s*(?:#.*)?$/);
    if (!match) continue;
    const parsed = splitPackageKey(match[1]);
    if (!parsed) continue;
    const key = `${parsed.name}@${parsed.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(component({
      type: 'library',
      name: parsed.name,
      version: parsed.version,
      reference: `pnpm:${sha256(key).slice(0, 32)}`,
      purl: npmPurl(parsed.name, parsed.version),
    }));
  }
  if (components.length === 0) {
    const lockVersion = input.text.match(/^lockfileVersion:\s*['"]?([^'"\s]+)/m)?.[1] ?? 'unknown';
    components.push(component({
      type: 'file',
      name: 'pnpm-lock.yaml',
      version: lockVersion,
      reference: `pnpm-lock:${sha256(input.text).slice(0, 32)}`,
    }));
  }
  return components.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function dockerEvidence(input) {
  const labels = {};
  const logical = input.text.replace(/\\\r?\n/g, ' ');
  for (const match of logical.matchAll(/^\s*LABEL\s+(.+)$/gim)) {
    const labelText = match[1].replace(/\s+#.*$/, '');
    for (const token of labelText.matchAll(/([A-Za-z0-9_.-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) {
      labels[token[1]] = token[2] ?? token[3] ?? token[4] ?? '';
    }
  }
  const stageSources = new Map();
  const fromLines = [...input.text.matchAll(/^\s*FROM(?:\s+--[^\s]+)?\s+(\S+)(?:\s+AS\s+(\S+))?/gim)];
  const baseImages = [...new Set(fromLines.map((match) => {
    const source = stageSources.get(match[1]) ?? match[1];
    if (match[2]) stageSources.set(match[2], source);
    return source;
  }))].sort();
  const properties = [
    { name: 'elogbook.evidence.source', value: input.path },
    { name: 'elogbook.docker.base-images', value: baseImages.join(',') },
    ...Object.keys(labels).sort().map((key) => ({ name: `elogbook.docker.label.${key}`, value: labels[key] })),
  ];
  return {
    labels: Object.fromEntries(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))),
    baseImages,
    properties,
  };
}

function denoComponent(identifier) {
  const value = unquote(identifier);
  let name = value;
  let version = 'locked';
  const versionMatch = value.match(/(?:@|^https:\/\/deno\.land\/std@)([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)/);
  if (versionMatch) version = versionMatch[1];
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    name = segments.at(-1) ?? parsed.hostname;
    if (name.endsWith('.ts')) name = name.slice(0, -3);
  } catch {
    name = value.split('/').at(-1) ?? value;
  }
  return component({
    type: 'library',
    name,
    version,
    reference: `deno:${sha256(value).slice(0, 32)}`,
    properties: [{ name: 'elogbook.deno.lock-key', value }],
  });
}

function denoComponents(input) {
  const lock = parseJson(input, input.path);
  const identifiers = new Set([
    ...Object.keys(lock.remote ?? {}),
    ...Object.keys(lock.redirects ?? {}),
    ...Object.keys(lock.packages ?? {}),
  ]);
  const components = [...identifiers].sort().map(denoComponent);
  if (components.length === 0) {
    components.push(component({
      type: 'file',
      name: 'deno.lock',
      version: lock.version ?? 'locked',
      reference: `deno-lock:${sha256(input.text).slice(0, 32)}`,
    }));
  }
  return components;
}

function mobileEvidence(input, root) {
  const eas = parseJson(input, input.path);
  const appPath = resolve(root, 'apps/mobile/app.json');
  let app = null;
  try {
    if (existsSync(appPath)) app = JSON.parse(readFileSync(appPath, 'utf8')).expo ?? null;
  } catch {
    app = null;
  }
  const profiles = eas.build && typeof eas.build === 'object' ? Object.keys(eas.build).sort() : [];
  const production = eas.build?.production ?? {};
  const properties = [
    { name: 'elogbook.evidence.source', value: input.path },
    { name: 'elogbook.mobile.eas-cli', value: String(eas.cli?.version ?? 'unknown') },
    { name: 'elogbook.mobile.profiles', value: profiles.join(',') },
    { name: 'elogbook.mobile.production.distribution', value: String(production.distribution ?? 'unknown') },
    { name: 'elogbook.mobile.production.channel', value: String(production.channel ?? 'unknown') },
  ];
  return {
    app,
    eas,
    profiles,
    properties,
    metadata: {
      cliVersion: String(eas.cli?.version ?? 'unknown'),
      profiles,
      production: {
        distribution: String(production.distribution ?? 'unknown'),
        channel: String(production.channel ?? 'unknown'),
        androidBuildType: String(production.android?.buildType ?? 'unknown'),
      },
    },
  };
}

function uuidFromHash(value) {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function makeBom({ kind, commit, components, properties }) {
  const referenceMaterial = { kind, commit, components, properties };
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${uuidFromHash(stableJson(referenceMaterial))}`,
    version: 1,
    metadata: {
      tools: [{ vendor: 'E-Logbook', name: 'generate-release-evidence', version: '1' }],
      component: {
        type: 'application',
        name: 'elogbook-release',
        version: commit.slice(0, 12),
        'bom-ref': `release:${commit}`,
      },
      properties: [
        { name: 'elogbook.evidence.kind', value: kind },
        { name: 'elogbook.release.commit', value: commit },
        ...properties,
      ],
    },
    components,
  };
}

function inputRecord(input, metadata) {
  const { text, ...record } = input;
  return { ...record, metadata };
}

export function resolveCommit({ root = ROOT, commit } = {}) {
  const candidate = commit ?? process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA;
  if (candidate) {
    if (!/^[0-9a-f]{40}$/i.test(candidate)) throw new EvidenceError('release commit must be a full 40-character Git SHA');
    return candidate.toLowerCase();
  }
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error('git returned an invalid SHA');
    return value.toLowerCase();
  } catch (error) {
    throw new EvidenceError(`current release commit is unavailable: ${error.message}`);
  }
}

export function buildEvidence({ root = ROOT, commit } = {}) {
  const repositoryRoot = resolve(root);
  const releaseCommit = resolveCommit({ root: repositoryRoot, commit });
  const inputs = REQUIRED_INPUTS.map((definition) => readInput(repositoryRoot, definition));
  const byKind = Object.fromEntries(inputs.map((input) => [input.kind, input]));
  const pnpm = pnpmComponents(byKind['pnpm-lock']);
  const docker = dockerEvidence(byKind.dockerfile);
  const denoLock = parseJson(byKind['deno-lock'], byKind['deno-lock'].path);
  const deno = denoComponents(byKind['deno-lock']);
  const mobile = mobileEvidence(byKind['mobile-eas'], repositoryRoot);
  const sourceMetadata = {
    'pnpm-lock': {
      lockfileVersion: byKind['pnpm-lock'].text.match(/^lockfileVersion:\s*['"]?([^'"\s]+)/m)?.[1] ?? 'unknown',
      componentCount: pnpm.length,
    },
    dockerfile: {
      labels: docker.labels,
      baseImages: docker.baseImages,
    },
    'deno-config': {
      lock: parseJson(byKind['deno-config'], byKind['deno-config'].path).lock ?? null,
    },
    'deno-lock': {
      version: denoLock.version ?? 'unknown',
      componentCount: deno.length,
    },
    'mobile-eas': mobile.metadata,
  };
  const containerComponent = component({
    type: 'container',
    name: 'elogbook-web',
    version: releaseCommit.slice(0, 12),
    reference: `container:${sha256(byKind.dockerfile.text).slice(0, 32)}`,
    properties: docker.properties,
  });
  const mobileComponent = component({
    type: 'application',
    name: mobile.app?.slug ?? '@elogbook/mobile',
    version: mobile.app?.version ?? '0.0.0',
    reference: `mobile:${sha256(byKind['mobile-eas'].text).slice(0, 32)}`,
    properties: mobile.properties,
  });
  const boms = {
    pnpm: makeBom({ kind: 'pnpm', commit: releaseCommit, components: pnpm, properties: [{ name: 'elogbook.lock.sha256', value: byKind['pnpm-lock'].sha256 }] }),
    container: makeBom({ kind: 'container', commit: releaseCommit, components: [containerComponent], properties: docker.properties }),
    deno: makeBom({ kind: 'deno', commit: releaseCommit, components: deno, properties: [{ name: 'elogbook.lock.sha256', value: byKind['deno-lock'].sha256 }] }),
    mobile: makeBom({ kind: 'mobile', commit: releaseCommit, components: [mobileComponent], properties: mobile.properties }),
  };
  const files = {};
  for (const [kind, bom] of Object.entries(boms)) files[`${kind}.cdx.json`] = jsonText(bom);
  const manifests = Object.fromEntries(Object.entries(boms).map(([kind]) => {
    const path = `${kind}.cdx.json`;
    return [kind, { path, sha256: sha256(files[path]) }];
  }));
  const artifacts = Object.fromEntries(Object.entries(manifests).map(([kind, entry]) => [kind, {
    path: entry.path,
    sha256: entry.sha256,
    signature: { status: 'unsigned' },
  }]));
  const manifest = {
    schema: 'elogbook.release-evidence/v1',
    commit: releaseCommit,
    deterministic: true,
    provenance: {
      status: 'unsigned',
      attestation: 'pending',
      signatures: [],
      externalAttestationConfigured: false,
    },
    artifacts,
    attestations: [],
    productionControls: {
      status: 'pending',
      verifierConfigured: false,
    },
    inputs: inputs.map((input) => inputRecord(input, sourceMetadata[input.kind])),
    manifests,
    checksums: { path: 'checksums.json' },
  };
  files['manifest.json'] = jsonText(manifest);
  const checksumPaths = Object.keys(files).sort();
  files['checksums.json'] = jsonText(Object.fromEntries(checksumPaths.map((path) => [path, sha256(files[path])])));
  return {
    commit: releaseCommit,
    manifest,
    files,
  };
}

export function generateReleaseEvidence({ root = ROOT, output = DEFAULT_OUTPUT, commit } = {}) {
  const repositoryRoot = resolve(root);
  const outputDirectory = resolve(repositoryRoot, output);
  const built = buildEvidence({ root: repositoryRoot, commit });
  mkdirSync(outputDirectory, { recursive: true });
  for (const [path, content] of Object.entries(built.files)) {
    const destination = resolve(outputDirectory, path);
    const relativeDestination = relative(outputDirectory, destination).split(sep).join('/');
    if (relativeDestination.startsWith('../') || relativeDestination.includes('/../')) {
      throw new EvidenceError(`evidence output path escapes output directory: ${path}`);
    }
    writeFileSync(destination, content, 'utf8');
  }
  return { ...built, outputDirectory };
}

export function parseArguments(argv = []) {
  const options = { root: ROOT, output: DEFAULT_OUTPUT, commit: undefined, all: false, verify: false, mode: 'promotion' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') options.all = true;
    else if (argument === '--verify') options.verify = true;
    else if (argument === '--deterministic-only') options.mode = 'deterministic-only';
    else if (argument === '--require-promotion') options.mode = 'promotion';
    else if (argument === '--root' || argument === '--output' || argument === '--commit') {
      const value = argv[index + 1];
      if (!value) throw new EvidenceError(`${argument} requires a value`);
      if (argument === '--root') options.root = resolve(value);
      if (argument === '--output') options.output = value;
      if (argument === '--commit') options.commit = value;
      index += 1;
    } else if (argument.startsWith('--root=')) options.root = resolve(argv[index].slice('--root='.length));
    else if (argument.startsWith('--output=')) options.output = argv[index].slice('--output='.length);
    else if (argument.startsWith('--commit=')) options.commit = argv[index].slice('--commit='.length);
    else throw new EvidenceError(`unknown option: ${argument}`);
  }
  return options;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.verify) {
      if (options.all) generateReleaseEvidence(options);
      try {
        execFileSync(process.execPath, [
          resolve(import.meta.dirname, 'verify-release-evidence.mjs'),
          ...process.argv.slice(2),
        ], { stdio: 'inherit' });
      } catch {
        process.exitCode = 1;
      }
      return;
    }
    const result = generateReleaseEvidence(options);
    console.log(`release-evidence-generated: ${result.outputDirectory}`);
    console.log('provenance: unsigned/pending');
  } catch (error) {
    console.error(`release-evidence-error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
