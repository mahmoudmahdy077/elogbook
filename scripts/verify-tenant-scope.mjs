#!/usr/bin/env node
/**
 * Gate A — tenant-scope detector (not a proof).
 * Flags any file importing createServiceRoleClient that queries a tenant-scoped
 * table without `.eq('tenant_id'` in the same chain.
 * False negatives: helper functions, RPC, joins. False positives: intentionally global.
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

for (const file of allFiles) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('createServiceRoleClient')) continue;
  checked++;

  // Bind the service-role client to its variable names. A file may hold both a
  // service-role client and an RLS-scoped one; only queries that actually start
  // from the service-role client can bypass RLS, so only those are in scope.
  const serviceRoleNames = new Set();
  const assignRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?createServiceRoleClient\s*\(/g;
  let a;
  while ((a = assignRe.exec(src))) serviceRoleNames.add(a[1]);
  if (/\bcreateServiceRoleClient\s*\(\s*\)\s*\.\s*from\s*\(/.test(src)) serviceRoleNames.add('');

  // Find all from('table') occurrences, capturing the receiver so that an
  // RLS-scoped query is not confused with a service-role one. `at` is the index
  // of `.from(` itself, which is what the exemption comment and the scan window
  // must be anchored to.
  const fromRe = /([A-Za-z_$][\w$]*)?\s*(\.from\(\s*['"`]([^'"`]+)['"`]\s*\))/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const receiver = m[1];
    const table = m[3];
    const at = m.index + m[0].length - m[2].length;
    if (!TENANT_SCOPED.has(table)) continue;

    // Only a query that actually starts from the service-role client can bypass
    // RLS. An unnamed `.from(` is a chained call; it is in scope only when the
    // chain is rooted directly in `createServiceRoleClient()`.
    const before = src.slice(Math.max(0, at - 40), at);
    if (receiver === undefined) {
      if (!/createServiceRoleClient\s*\(\s*\)\s*$/.test(before)) continue;
    } else if (!serviceRoleNames.has(receiver)) {
      continue;
    }

    // Exempt comment: // tenant-scope-exempt: <reason>
    const lineStart = src.lastIndexOf('\n', at) + 1;
    const lineEnd = src.indexOf('\n', at);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (line.includes('tenant-scope-exempt:')) continue;

    // Skip inserts — tenant scoping there is via payload tenant_id, not eq filter
    const window = src.slice(at, at + 800);
    if (window.includes('.insert(')) continue;
    // Skip tenants table which is often intentionally global (list)
    if (table === 'tenants' && window.includes('.select(')) continue;

    if (!window.includes("eq('tenant_id'") && !window.includes('eq("tenant_id"') && !window.includes("eq(`tenant_id`")) {
      flagged.push({ file: file.replace(ROOT + '/', ''), table, snippet: line.trim().slice(0,120) });
    }
  }
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
