#!/usr/bin/env node
/**
 * M0 — mobile ledger + hygiene gate.
 * Checks (fail-closed, no dependencies):
 *  1. docs/upgrade/evidence/mobile/ledger.yaml schema + status vocabulary.
 *  2. Every non-blocked entry has a test or artifactPolicy; every
 *     artifact-verified entry has a real artifact link.
 *  3. Forbidden production-certification claims outside explicit NO-GO /
 *     historical markers in mobile evidence docs.
 *  4. Unapproved console.(warn|error|log) in apps/mobile production code
 *     (allowlist: lib/logger.ts and __tests__).
 *
 * Usage: node scripts/check-mobile-ledger.mjs [--root <repo>]
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = resolve(rootIdx >= 0 ? args[rootIdx + 1] : process.cwd());

let failures = [];
const fail = (msg) => failures.push(msg);

// --- 1+2. ledger.yaml -------------------------------------------------------
const REQUIRED = ['id', 'claim', 'requirement', 'source', 'implementation', 'test', 'artifact', 'owner', 'status', 'reviewedAt', 'expiryPolicy', 'blocker'];
const STATUS = new Set(['wired', 'tested', 'artifact-verified', 'blocked']);
const IMPL = new Set(['wired', 'blocked']);

function parseSimpleYaml(text) {
  // Minimal parser for this file's shape: top-level scalars + entries list of scalars/null.
  const lines = text.split('\n');
  const entries = [];
  let cur = null;
  let inEntries = false;
  for (const line of lines) {
    if (/^entries:\s*$/.test(line)) { inEntries = true; continue; }
    if (!inEntries) continue;
    const start = line.match(/^  - id:\s*(.+)\s*$/);
    if (start) { cur = { id: start[1].trim() }; entries.push(cur); continue; }
    const kv = line.match(/^    ([A-Za-z]+):\s*(.*)\s*$/);
    if (kv && cur) {
      let v = kv[2].trim();
      if (v === 'null') v = null;
      else if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      cur[kv[1]] = v;
    }
  }
  return entries;
}

try {
  const raw = readFileSync(join(ROOT, 'docs/upgrade/evidence/mobile/ledger.yaml'), 'utf-8');
  const entries = parseSimpleYaml(raw);
  if (entries.length === 0) fail('ledger.yaml: no entries parsed');
  const seen = new Set();
  for (const e of entries) {
    for (const k of REQUIRED) {
      if (!(k in e)) fail(`ledger.yaml: entry ${e.id ?? '?'} missing field ${k}`);
    }
    if (seen.has(e.id)) fail(`ledger.yaml: duplicate id ${e.id}`);
    seen.add(e.id);
    if (e.status && !STATUS.has(e.status)) fail(`ledger.yaml: entry ${e.id} bad status ${e.status}`);
    if (e.implementation && !IMPL.has(e.implementation)) fail(`ledger.yaml: entry ${e.id} bad implementation ${e.implementation}`);
    if (e.status === 'artifact-verified' && !e.artifact) fail(`ledger.yaml: entry ${e.id} claims artifact-verified without artifact`);
    if ((e.status === 'wired' || e.status === 'tested') && !e.test && !e.artifactPolicy) {
      fail(`ledger.yaml: entry ${e.id} is ${e.status} without test or artifactPolicy`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.reviewedAt ?? '')) fail(`ledger.yaml: entry ${e.id} bad reviewedAt`);
    if (e.status === 'blocked' && !e.blocker) fail(`ledger.yaml: entry ${e.id} blocked without blocker`);
    // Referenced test files must exist (missing tests are not evidence).
    for (const t of (e.test ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      try {
        statSync(join(ROOT, t));
      } catch {
        fail(`ledger.yaml: entry ${e.id} references missing test ${t}`);
      }
    }
  }
  // No universal day-based expiry allowed: every entry must carry an event-based policy.
  for (const e of entries) {
    if (e.expiryPolicy && /\b30[- ]day\b/i.test(e.expiryPolicy)) fail(`ledger.yaml: entry ${e.id} uses arbitrary day-based expiry`);
  }
} catch (err) {
  fail(`ledger.yaml: unreadable (${err.message})`);
}

// --- 3. forbidden claims ----------------------------------------------------
const FORBIDDEN = [/production[\s-]*ready/i, /production[\s-]*certified/i, /enterprise[\s-]*ready(?!\s+review)/i, /hipaa[\s-]*compliant/i, /hipaa[\s-]*certified/i, /app[\s-]*store[\s-]*approved/i];
const CLAIM_ALLOW = ['NO-GO', 'not production', 'non-production', 'historical'];
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(md|mdx)$/.test(name)) out.push(p);
  }
  return out;
}
try {
  const docs = walk(join(ROOT, 'docs/upgrade/evidence/mobile'));
  for (const f of docs) {
    const text = readFileSync(f, 'utf-8');
    for (const re of FORBIDDEN) {
      const m = text.match(re);
      if (m) {
        const ctx = text.slice(Math.max(0, m.index - 80), m.index + 80);
        if (!CLAIM_ALLOW.some((a) => ctx.toLowerCase().includes(a.toLowerCase()))) {
          fail(`${f}: forbidden certification claim near "${m[0]}"`);
        }
      }
    }
  }
} catch (err) {
  fail(`claim scan: ${err.message}`);
}

// --- 4. console usage -------------------------------------------------------
const CONSOLE_RE = /console\.(warn|error|log)\s*\(/;
function walkCode(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!['node_modules', '__tests__', '.expo', 'android'].includes(name)) walkCode(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const CONSOLE_ALLOW = ['apps/mobile/lib/logger.ts', 'apps/mobile/lib/sync/in-memory-repo.ts'];
try {
  const files = walkCode(join(ROOT, 'apps/mobile'));
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (CONSOLE_ALLOW.includes(rel)) continue;
    const text = readFileSync(f, 'utf-8');
    const m = text.match(CONSOLE_RE);
    if (m) fail(`${rel}: unapproved ${m[0].trim()} — route through lib/logger.ts`);
  }
} catch (err) {
  fail(`console scan: ${err.message}`);
}

// --- 5. release-env consistency (R1: Sentry DSN divergence) ------------------
// Runtime code reads EXPO_PUBLIC_* (inlined at build); a bare SENTRY_DSN in
// workflows or bundled code silently diverges source-map vs runtime config.
try {
  const targets = [];
  for (const f of readdirSync(join(ROOT, '.github/workflows'))) {
    if (/\.ya?ml$/.test(f)) targets.push(join(ROOT, '.github/workflows', f));
  }
  for (const f of walkCode(join(ROOT, 'apps/mobile'))) targets.push(f);
  for (const f of targets) {
    const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
    const text = readFileSync(f, 'utf-8');
    // Match SENTRY_DSN not preceded by EXPO_PUBLIC_ (runtime) and not part
    // of the secrets.SENTRY_DSN *source* reference on the right-hand side.
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/secrets\.SENTRY_DSN/.test(line)) return; // secret source: allowed
      // Flag runtime reads of the wrong variable and YAML env keys — not a
      // local const that was itself assigned from EXPO_PUBLIC_SENTRY_DSN.
      if (/process\.env\.SENTRY_DSN\b/.test(line) || /^\s*SENTRY_DSN\s*:/.test(line)) {
        fail(`${rel}:${i + 1}: bare SENTRY_DSN diverges from runtime EXPO_PUBLIC_SENTRY_DSN`);
      }
    });
  }
} catch (err) {
  fail(`env scan: ${err.message}`);
}

if (failures.length > 0) {
  console.error(`check-mobile-ledger: ${failures.length} failure(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('check-mobile-ledger: OK');
