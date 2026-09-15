#!/usr/bin/env node
/**
 * N2.4 — sensitive-write inventory gate.
 *
 * Fails when a mobile screen/component performs a raw Supabase write
 * (insert/update/upsert/delete, or a non-read RPC) on a sensitive table
 * without routing through an approved adapter (lib/case-submit.ts,
 * lib/operations.ts). Read-only RPCs (hash_patient_mrn) and non-sensitive
 * tables (template_favorites) are allowed. Review exceptions explicitly by
 * extending ADAPTER_IMPORTS with a ledger reference — never by weakening
 * the table list.
 *
 * Usage: node scripts/check-mobile-adapters.mjs [--root <repo>]
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = resolve(rootIdx >= 0 ? args[rootIdx + 1] : process.cwd());
const APP_DIRS = ['apps/mobile/app', 'apps/mobile/components'];

const SENSITIVE_TABLES = new Set([
  'case_entries', 'evaluation_forms', 'duty_periods', 'approval_requests',
  'case_attachments', 'profiles', 'audit_logs', 'notifications', 'push_tokens',
  'case_templates', 'tenants',
]);
const ADAPTER_IMPORTS = ['lib/case-submit', 'lib/operations'];
const READ_RPCS = new Set(['hash_patient_mrn']);

function walk(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const dir of APP_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf-8');
    const viaAdapter = ADAPTER_IMPORTS.some((m) => text.includes(m));
    if (viaAdapter) continue;
    const writeRe = /\.from\(\s*['"]([a-z_]+)['"]\s*\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\s*\(/g;
    let m;
    while ((m = writeRe.exec(text)) !== null) {
      if (SENSITIVE_TABLES.has(m[1])) {
        failures.push(`${rel}: raw .${m[2]}() on sensitive table ${m[1]} without an approved adapter import`);
      }
    }
    const rpcRe = /\.rpc\(\s*['"]([a-z_]+)['"]/g;
    while ((m = rpcRe.exec(text)) !== null) {
      if (!READ_RPCS.has(m[1])) {
        failures.push(`${rel}: raw .rpc('${m[1]}') without an approved adapter import`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`check-mobile-adapters: ${failures.length} violation(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('check-mobile-adapters: OK');
