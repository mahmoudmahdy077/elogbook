#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'coverage',
  '.expo',
  '.turbo',
  'test-results',
  'playwright-report',
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml']);

export const reviewedExemptions = new Map([
  ['config/mcporter.json', new Set(['tool'])],
  ['supabase/functions/ai-insights/index.ts', new Set(['http', 'sql'])],
  ['supabase/functions/ai-quality/index.ts', new Set(['http', 'sql'])],
  ['supabase/functions/ai-gap-analysis/index.ts', new Set(['sql'])],
  ['apps/web/app/api/[tenant]/admin/ai-config/route.ts', new Set(['sql'])],
]);

export const reviewedExemptionReasons = new Map([
  ['config/mcporter.json', 'reviewed local MCP client configuration; it is not a production runtime permission'],
  ['supabase/functions/ai-insights/index.ts', 'reviewed provider egress and tenant-scoped Supabase queries behind the AI guard'],
  ['supabase/functions/ai-quality/index.ts', 'reviewed provider egress and tenant-scoped Supabase queries behind the AI guard'],
  ['supabase/functions/ai-gap-analysis/index.ts', 'reviewed tenant-scoped Supabase reads behind the AI guard'],
  ['apps/web/app/api/[tenant]/admin/ai-config/route.ts', 'reviewed tenant-scoped configuration write behind requireTenantAdmin'],
]);

const rules = [
  {
    id: 'shell',
    regex: /\b(?:child_process|execSync|spawnSync|execFile|execFileSync|Deno\.Command|spawn|exec)\s*\(/g,
  },
  {
    id: 'sql',
    regex: /\b(?:supabase|client|db|serviceSupabase|serviceClient)\.(?:from|rpc|sql)\s*\(|\.rpc\s*\(/g,
  },
  {
    id: 'http',
    regex: /\b(?:fetch|Deno\.fetch|axios\.(?:get|post|put|patch|delete)|http\.request|https\.request)\s*\(/g,
  },
  {
    id: 'tool',
    regex: /\b(?:executeTool|runTool|invokeTool)\s*\(|\btools\.(?:run|execute|call)\s*\(|\bmcp\.[A-Za-z0-9_.-]+\s*\(|\bmcpServers\s*["']?\s*[:=]|["']tools["']\s*:\s*\[/gi,
  },
];

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isAgentSurface(path) {
  const normalized = normalizePath(path).toLowerCase();
  const segments = normalized.split('/');
  if (segments.some((segment) => ['agent', 'agents', '.agent', '.agents', '.claude', '.opencode'].includes(segment))) return true;
  if (segments.includes('config')) return true;
  if (normalized.includes('/ai-') || normalized.includes('/ai/') || normalized.endsWith('/ai.ts') || normalized.includes('ai-config')) return true;
  return false;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function exemptionSet(path, options = {}) {
  if (options.exemptions instanceof Map && options.exemptions.has(path)) return options.exemptions.get(path);
  return reviewedExemptions.get(path) ?? new Set();
}

export function scanText(path, source, options = {}) {
  const normalizedPath = normalizePath(path);
  if (!isAgentSurface(normalizedPath)) return [];
  const exemptions = exemptionSet(normalizedPath, options);
  const findings = [];
  const lines = stripComments(String(source)).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  for (const rule of rules) {
    if (exemptions.has(rule.id)) continue;
    const expression = new RegExp(rule.regex.source, rule.regex.flags);
    for (let index = 0; index < lines.length; index += 1) {
      expression.lastIndex = 0;
      let match;
      while ((match = expression.exec(lines[index])) !== null) {
        findings.push({ path: normalizedPath, line: index + 1, rule: rule.id });
        if (match.index === expression.lastIndex) expression.lastIndex += 1;
      }
    }
  }
  return findings.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory)) {
    if (excludedDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, output);
    else if (sourceExtensions.has(extname(entry).toLowerCase())) output.push(path);
  }
  return output;
}

export function scanRepository({ root = ROOT } = {}) {
  const absoluteRoot = resolve(root);
  const findings = [];
  for (const file of walk(absoluteRoot)) {
    const path = relative(absoluteRoot, file).replaceAll('\\', '/');
    if (!isAgentSurface(path)) continue;
    findings.push(...scanText(path, readFileSync(file, 'utf8')));
  }
  return {
    findings: findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule)),
    failed: findings.length > 0,
  };
}

function main() {
  try {
    const result = scanRepository();
    for (const finding of result.findings) {
      console.log(`${finding.path}:${finding.line}:${finding.rule}`);
    }
    if (result.failed) {
      process.exitCode = 1;
      return;
    }
    console.log('agent-boundaries: pass');
  } catch {
    console.error('agent-boundaries: scan failed');
    process.exitCode = 2;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();

export { rules };
