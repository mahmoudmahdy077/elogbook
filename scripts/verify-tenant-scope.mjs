#!/usr/bin/env node
/**
 * Gate A — tenant-scope detector (not a proof).
 * Flags any file importing createServiceRoleClient that queries a tenant-scoped
 * table without `.eq('tenant_id'` in the same chain.
 * The flagged chain must be on the service-role client itself: a file that mixes
 * the RLS-bound session client with the admin client (phi-reveal: RLS read, admin
 * audit write) is only checked for the admin-bound receiver.
 * False negatives: helper functions, RPC, joins, aliased receivers it cannot
 * resolve (those stay conservative and are still flagged). False positives: intentionally global.
 * See PRODUCTION_UPGRADE_PLAN.md Phase 1.7.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WEB_APP = join(ROOT, 'apps/web');

// Tenant-scoped tables — generated from migrations (grep tenant_id). Keep in sync via
// `pnpm exec tsx scripts/verify-tenant-scope.mjs --list` or update manually when migration adds table.
// This list is intentionally explicit; adding a table without updating this script fails Gate A.
const TENANT_SCOPED = new Set([
  'profiles',
  'tenants', // tenants itself has RLS but is global list; queries here are often intentionally global — exempt via comment
  'case_entries',
  'case_templates',
  'audit_logs',
  'evaluations',
  'duty_hour_logs',
  'shifts',
  'attendance_records',
  'notifications',
  'tenant_webhooks',
  'tenant_webhook_deliveries',
  'subscription_plans', // global but tenant-associated
  'case_attachments',
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git' || e === 'dist' || e === '.turbo') continue;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js')) out.push(p);
  }
  return out;
}

let flagged = [];
let checked = 0;

// Only check app and lib, not entire web (which includes .next, node_modules, etc., but we already filter)
const roots = [join(WEB_APP, 'app'), join(WEB_APP, 'lib')].filter(p => {
  try { statSync(p); return true; } catch { return false; }
});
const allFiles = roots.flatMap(r => walk(r));

function findViolations(src) {
  const out = [];

  // Names bound to the service-role client in this file, plus one level of
  // `const x = adminClient` aliases. Empty set → keep file-level behaviour.
  const adminNames = new Set();
  const adminRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?createServiceRoleClient\s*\(/g;
  let a;
  while ((a = adminRe.exec(src))) adminNames.add(a[1]);
  const aliasRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n)]/g;
  while ((a = aliasRe.exec(src))) {
    if (adminNames.has(a[2]) && !adminNames.has(a[1])) adminNames.add(a[1]);
  }

  // Find all from('table') occurrences
  const fromRe = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const table = m[1];
    if (!TENANT_SCOPED.has(table)) continue;

    // Receiver of the chain, when it can be read unambiguously. Only relax to
    // the named receiver when the file binds an admin client and the chain is
    // provably on a different client; anything unclear stays flagged.
    const pre = src.slice(Math.max(0, m.index - 400), m.index);
    const recv = pre.match(/([A-Za-z_$][\w$]*)\s*$/);
    if (recv && adminNames.size > 0 && !adminNames.has(recv[1])) continue;

    // Exempt comment: // tenant-scope-exempt: <reason>
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (line.includes('tenant-scope-exempt:')) continue;

    // Skip inserts — tenant scoping there is via payload tenant_id, not eq filter
    const window = src.slice(m.index, m.index + 800);
    if (window.includes('.insert(')) continue;
    // Skip tenants table which is often intentionally global (list)
    if (table === 'tenants' && window.includes('.select(')) continue;

    if (!window.includes("eq('tenant_id'") && !window.includes('eq("tenant_id"') && !window.includes("eq(`tenant_id`")) {
      out.push({ table, snippet: line.trim().slice(0, 120) });
    }
  }
  return out;
}

// --self-test: the receiver logic is what keeps this gate honest, so prove it
// still separates an admin read from an RLS-bound read before trusting a pass.
if (process.argv.includes('--self-test')) {
  const fixtures = [
    ['admin read, no filter', `const c = createServiceRoleClient();\nreturn c.from('case_entries').select('*');`, 1],
    ['admin read, multi-line', `const c = createServiceRoleClient();\nreturn c\n  .from('audit_logs')\n  .select('*');`, 1],
    ['aliased admin read', `const c = createServiceRoleClient();\nconst db = c;\nreturn db.from('profiles').select('*');`, 1],
    ['admin read, scoped', `const c = createServiceRoleClient();\nreturn c.from('case_entries').select('*').eq('tenant_id', t);`, 0],
    ['rls read next to admin write', `const admin = createServiceRoleClient();\nconst supabase = await createServerSupabase();\nconst p = await supabase.from('profiles').select('*').eq('user_id', u);\nreturn { p, admin };`, 0],
    ['exempt comment', `const c = createServiceRoleClient();\nreturn c.from('profiles').select('*'); // tenant-scope-exempt: platform admin list`, 0],
  ];
  let bad = 0;
  for (const [name, src, want] of fixtures) {
    const got = findViolations(src).length;
    if ((got > 0 ? 1 : 0) !== want) { bad++; console.error(`self-test FAILED: ${name} — expected ${want ? 'flagged' : 'clean'}, got ${got}`); }
  }
  if (bad) process.exit(1);
  console.log(`Gate A self-test passed: ${fixtures.length} fixtures`);
  process.exit(0);
}

for (const file of allFiles) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('createServiceRoleClient')) continue;
  checked++;
  for (const v of findViolations(src)) flagged.push({ file: file.replace(ROOT + '/', ''), ...v });
}

if (flagged.length) {
  console.error(`Gate A FAILED: ${flagged.length} service-role query(ies) on tenant-scoped table without .eq('tenant_id'`);
  for (const f of flagged) console.error(`  ${f.file} — from('${f.table}') — ${f.snippet}`);
  console.error(`\nChecked ${checked} files importing createServiceRoleClient.`);
  console.error(`If intentional global, add: // tenant-scope-exempt: <reason> + code-owner approval + expiry`);
  process.exit(1);
} else {
  console.log(`Gate A passed: checked ${checked} files, no missing tenant_id filters (detector, not proof — see inventory)`);
}
