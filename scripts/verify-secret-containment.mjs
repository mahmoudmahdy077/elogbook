#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_GIT_OUTPUT = 128 * 1024 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const excludedSegments = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.expo',
  '.vercel',
  '.pnpm-store',
  '.temp',
  'out',
  'target',
  'test-results',
  'playwright-report',
  'blob-report',
  'cache',
  'caches',
  'generated',
  '__generated__',
  '.svelte-kit',
  '.parcel-cache',
  '.angular',
  '.docusaurus',
]);
const binaryExtensions = new Set([
  '.7z',
  '.aac',
  '.apk',
  '.avi',
  '.avif',
  '.bin',
  '.bmp',
  '.bson',
  '.class',
  '.dat',
  '.db',
  '.dll',
  '.dylib',
  '.dmg',
  '.doc',
  '.docx',
  '.eot',
  '.elf',
  '.exe',
  '.flac',
  '.gif',
  '.gz',
  '.icns',
  '.ico',
  '.ipa',
  '.jpeg',
  '.jpg',
  '.jar',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogg',
  '.otf',
  '.parquet',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.psd',
  '.pyc',
  '.pyo',
  '.safetensors',
  '.sketch',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.tgz',
  '.ttf',
  '.wasm',
  '.war',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.zip',
]);

const rules = [
  {
    id: 'supabase-jwt',
    regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: 'private-key-header',
    regex: /^\s*-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----\s*$/g,
  },
  {
    id: 'supabase-service-role-assignment',
    regex: /\b(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_JWT|SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY)\b\s*(?:[:=]|=>)\s*["'`]?([A-Za-z0-9._~+/=-]{16,})/gi,
    secretGroup: 1,
  },
  {
    id: 'provider-key-prefix',
    regex: /(?:^|[^A-Za-z0-9])((?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|rk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|re_[A-Za-z0-9_-]{20,}))/g,
    secretGroup: 1,
  },
  {
    id: 'secret-assignment',
    regex: /\b[A-Z][A-Z0-9_]*(?:API[_ -]?KEY|SECRET[_ -]?KEY|ACCESS[_ -]?TOKEN|AUTH[_ -]?TOKEN|WEBHOOK[_ -]?SECRET|PROVIDER[_ -]?KEY|PROVIDER[_ -]?TOKEN|PASSWORD|CREDENTIALS?)\b\s*(?:[:=]|=>)\s*["'`]?([A-Za-z0-9._~+/=-]{16,})/gi,
    secretGroup: 1,
  },
  {
    id: 'secret-bearing-markdown',
    regex: /(?:[A-Z0-9_ -]*(?:API[_ -]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?|PRIVATE[_ -]?KEY)|SERVICE[_ -]?ROLE(?:[_ -]?KEY)?)\s*(?:[:=]|\bis\b)\s*["'`]?([A-Za-z0-9._~+/=-]{16,})/gi,
    secretGroup: 1,
    markdownOnly: true,
  },
];

const safePlaceholderPatterns = [
  /^\$\{[^{}\r\n]+\}$/,
  /^\$\{\{[^{}\r\n]+\}\}$/,
  /^\$[A-Z_][A-Z0-9_]*$/,
  /^\[REDACTED\]$/i,
  /^(?:your|change|replace|example|placeholder|dummy|not-a-real-secret)(?:[-_][a-z0-9]+)*$/i,
  /^(?:sk|rk|whsec|gh[pousr]|glpat|npm|xox[baprs]|github_pat|ai)(?:[_-](?:test|example|dummy|placeholder|xxx))+$/i,
  /^(?:process\.env|Deno\.env|import\.meta\.env|os\.environ)(?:[.\[]|$)/i,
];

// These are known code references in source/documentation examples, not embedded secret values.
// Keep this exception limited to the assignment rules so JWT and provider-key rules
// continue to inspect every value.
const safeReferencePatterns = [
  /^config\.[A-Za-z_$][A-Za-z0-9_$]*$/,
  /^(?:request\.headers|url\.searchParams)\.[A-Za-z_$][A-Za-z0-9_$]*$/,
  /^preauthorizeApiKey\.bind$/,
];

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function unwrapPlaceholder(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isSafePlaceholder(value) {
  const candidate = unwrapPlaceholder(String(value));
  return safePlaceholderPatterns.some((pattern) => pattern.test(candidate));
}

function isSafeReference(rule, value) {
  if (rule.id !== 'secret-assignment' && rule.id !== 'secret-bearing-markdown') return false;
  const candidate = unwrapPlaceholder(String(value));
  return safeReferencePatterns.some((pattern) => pattern.test(candidate));
}

function isMarkdown(path) {
  return /\.md(?:own)?$/i.test(normalizePath(path));
}

function matchesPath(rule, path) {
  return !rule.markdownOnly || isMarkdown(path);
}

function compileRule(rule) {
  const flags = rule.regex.flags.replaceAll('g', '') + 'g';
  return new RegExp(rule.regex.source, flags);
}

export function scanText(path, text) {
  const normalizedPath = normalizePath(path);
  const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const findings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of rules) {
      if (!matchesPath(rule, normalizedPath)) continue;
      const expression = compileRule(rule);
      let match;
      while ((match = expression.exec(line)) !== null) {
        const value = match[rule.secretGroup ?? 0] ?? match[0];
        if (!value || isSafePlaceholder(value) || isSafeReference(rule, value)) {
          if (match.index === expression.lastIndex) expression.lastIndex += 1;
          continue;
        }
        findings.push({
          path: normalizedPath,
          line: index + 1,
          rule: rule.id,
          hash: shortHash(value),
        });
        if (match.index === expression.lastIndex) expression.lastIndex += 1;
      }
    }
  }

  return deduplicateFindings(findings);
}

function isExcludedPath(path) {
  const normalizedPath = normalizePath(path);
  if (normalizedPath.toLowerCase().endsWith('.tsbuildinfo')) return true;
  return normalizedPath
    .split('/')
    .some((segment) => excludedSegments.has(segment));
}

function isBinaryFile(path, buffer) {
  return binaryExtensions.has(extname(path).toLowerCase()) || buffer.includes(0);
}

export function scanFile(root, path) {
  const normalizedPath = normalizePath(path);
  if (isExcludedPath(normalizedPath)) return [];
  const absolutePath = resolve(root, normalizedPath);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) return [];
  const buffer = readFileSync(absolutePath);
  if (isBinaryFile(normalizedPath, buffer)) return [];
  let text;
  try {
    text = textDecoder.decode(buffer);
  } catch {
    return [];
  }
  return scanText(normalizedPath, text);
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('secret-scan-git-command-failed');
  }
  return Buffer.from(result.stdout).toString('utf8');
}

function listWorkingTreeFiles(root, local) {
  const parse = (output) => output
    .split('\0')
    .filter(Boolean)
    .map(normalizePath);
  if (!local) return parse(gitOutput(root, ['ls-files', '-z']));
  return [...new Set([
    ...parse(gitOutput(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--directory'])),
    ...parse(gitOutput(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])),
  ])];
}

function historyObjectPaths(root) {
  const result = spawnSync('git', ['rev-list', '--objects', '--all'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error('secret-scan-git-command-failed');
  }

  const paths = new Map();
  for (const record of Buffer.from(result.stdout).toString('utf8').split(/\r?\n/).filter(Boolean)) {
    const separator = record.indexOf(' ');
    if (separator < 1) continue;
    paths.set(record.slice(0, separator), normalizePath(record.slice(separator + 1)));
  }
  return paths;
}

function historyFindings(root) {
  const objectPaths = historyObjectPaths(root);
  const objectIds = [...objectPaths.keys()];
  if (objectIds.length === 0) return [];

  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: Buffer.from(`${objectIds.join('\n')}\n`),
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('secret-scan-git-command-failed');
  }

  const output = Buffer.from(result.stdout);
  const findings = [];
  let offset = 0;
  while (offset < output.length) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) break;
    const header = output.subarray(offset, headerEnd).toString('utf8').split(' ');
    offset = headerEnd + 1;
    if (header[1] === 'missing') continue;
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('secret-scan-git-command-failed');
    }
    const end = offset + size;
    if (end > output.length) throw new Error('secret-scan-git-command-failed');
    const objectId = header[0];
    const path = objectPaths.get(objectId);
    if (header[1] === 'blob' && path && !isExcludedPath(path)) {
      const buffer = output.subarray(offset, end);
      if (!isBinaryFile(path, buffer)) {
        try {
          findings.push(...scanText(path, textDecoder.decode(buffer)));
        } catch {
          continue;
        }
      }
    }
    offset = end + 1;
  }
  return findings;
}

function deduplicateFindings(findings) {
  const unique = new Map();
  for (const finding of findings) {
    unique.set(`${finding.path}:${finding.line}:${finding.rule}:${finding.hash}`, finding);
  }
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.rule.localeCompare(right.rule)
    || left.hash.localeCompare(right.hash));
}

export function formatFinding(finding) {
  return `${finding.path}:${finding.line}:${finding.rule}:${finding.hash}`;
}

export function scanRepository({ root = ROOT, local = false, history = false } = {}) {
  const absoluteRoot = resolve(root);
  const findings = [];
  if (history) findings.push(...historyFindings(absoluteRoot));
  for (const path of new Set(listWorkingTreeFiles(absoluteRoot, local))) {
    findings.push(...scanFile(absoluteRoot, path));
  }
  const result = deduplicateFindings(findings);
  return { findings: result, failed: result.length > 0 };
}

function parseArguments(args) {
  const options = { local: false, history: false };
  for (const argument of args) {
    if (argument === '--local') options.local = true;
    else if (argument === '--history') options.history = true;
    else throw new Error('secret-scan-invalid-arguments');
  }
  return options;
}

function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(args);
    const result = scanRepository(options);
    for (const finding of result.findings) console.log(formatFinding(finding));
    if (result.failed) process.exitCode = 1;
    else console.log('secret-containment: pass');
  } catch {
    process.stderr.write('secret-containment: scan failed\n');
    process.exitCode = 2;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();

export { binaryExtensions, excludedSegments, rules, safePlaceholderPatterns };
