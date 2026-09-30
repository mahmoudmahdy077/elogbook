#!/usr/bin/env node
// Gate G — single client-IP derivation (necessary, not sufficient)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', '.git']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) walk(path, out);
    } else if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(join(ROOT, 'apps/web'));
const readers = [];
let helperExists = false;
for (const file of files) {
  if (file.includes('__tests__')) continue;
  const src = readFileSync(file, 'utf8');
  if (/x-forwarded-for/i.test(src)) {
    readers.push(file.replace(`${ROOT}/`, ''));
    const normalized = file.replace(/\\/g, '/');
    if (normalized.endsWith('lib/client-ip.ts')) helperExists = true;
  }
}
if (readers.length !== 1 || !helperExists) {
  console.error(`Gate G FAILED: expected exactly 1 reader (lib/client-ip.ts), found ${readers.length}:`);
  for (const reader of readers) console.error(`  ${reader}`);
  process.exit(1);
}

// Check helper consults trust boundary
const helperSrc = readFileSync(join(ROOT, 'apps/web/lib/client-ip.ts'), 'utf8');
if (!helperSrc.includes('TRUSTED_PROXY_HOPS')) {
  console.error('Gate G FAILED: helper must consult TRUSTED_PROXY_HOPS');
  process.exit(1);
}
const guardSrc = readFileSync(join(ROOT, 'apps/web/lib/setup/guard.ts'), 'utf8');
if (!guardSrc.includes('getClientIp') || guardSrc.includes('clientIpFromHeaders') || guardSrc.includes('trustedProxyHops')) {
  console.error('Gate G FAILED: setup guard must delegate to lib/client-ip.ts');
  process.exit(1);
}

// Check test coverage for spoofing cases
const testSrc = readFileSync(join(ROOT, 'apps/web/lib/__tests__/client-ip.test.ts'), 'utf8');
const requiredCases = ['hops=0', 'hops=1', 'hops=2'];
const missing = requiredCases.filter((requiredCase) => !testSrc.includes(requiredCase));
if (missing.length) {
  console.error('Gate G FAILED: test matrix missing cases:', missing.join(', '));
  process.exit(1);
}
console.log('Gate G passed: single reader (lib/client-ip.ts), trust boundary consulted, test matrix present');
