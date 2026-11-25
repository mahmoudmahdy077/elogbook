#!/usr/bin/env node
// Gate I — no service_role credential may be committed.
//
// Root cause this gate exists for: three `.hermes/swarm/*.mjs` diagnostics
// hard-coded a live Supabase `service_role` JWT (role=service_role, exp 2036)
// in a PUBLIC repository. That key bypasses RLS on every table, so anyone
// reading the repo had full database access. The files are scrubbed and the
// key must still be rotated: removing a secret from HEAD does not remove it
// from history or from anyone who already cloned it.
//
// This gate fails on any tracked file that contains a JWT whose payload says
// role=service_role, so the mistake cannot silently return. It does not scan
// history (that is a separate, expensive job); rotation is the only remedy
// for a leak that already happened.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|mp4|mov|lock)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!SKIP_EXT.test(p)) out.push(p);
  }
  return out;
}

function roleOf(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, 'base64url').toString('utf-8'));
    return json.role ?? json.user_role ?? null;
  } catch {
    return null;
  }
}

const offenders = [];
for (const file of walk(ROOT)) {
  // Skip this gate's own source: the docstring above names the pattern.
  if (relative(ROOT, file) === join('scripts', 'verify-no-service-role-secrets.mjs')) continue;
  let src;
  try {
    src = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  if (!src.includes('eyJ')) continue;
  for (const match of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (roleOf(match[0]) === 'service_role') offenders.push(relative(ROOT, file));
  }
}

if (offenders.length > 0) {
  console.error('Gate I FAILED: a service_role JWT is committed in tracked files:');
  for (const f of [...new Set(offenders)]) console.error(`  ${f}`);
  console.error('Remove it and read the key from process.env; rotate the key, because it is already public.');
  process.exit(1);
}

console.log('Gate I passed: no service_role JWT in tracked files');
