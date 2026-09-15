#!/usr/bin/env node
/**
 * R1 — Sentry DSN consistency gate (Approach C risk-first hardening).
 *
 * Runtime/source-map Sentry variables must not silently diverge:
 * - web client runtime reads NEXT_PUBLIC_SENTRY_DSN (apps/web/sentry.client.config.ts)
 * - web server/edge reads SENTRY_DSN ?? NEXT_PUBLIC_SENTRY_DSN
 * - mobile runtime reads EXPO_PUBLIC_SENTRY_DSN (apps/mobile/lib/sentry.ts)
 * - mobile EAS builds must populate EXPO_PUBLIC_SENTRY_DSN from a dedicated
 *   mobile secret (secrets.EXPO_PUBLIC_SENTRY_DSN), NOT from the server
 *   secrets.SENTRY_DSN. Mapping server DSN into mobile runtime silently
 *   couples two telemetry projects and hides divergence between runtime
 *   events and source-map upload (SENTRY_ORG/PROJECT/AUTH_TOKEN).
 *
 * Missing DSN is safe (both runtimes degrade to no-op). Wrong mapping is not.
 *
 * Usage: node scripts/check-sentry-consistency.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function mustContain(path, re, label) {
  const text = readFileSync(resolve(ROOT, path), 'utf-8');
  if (!re.test(text)) failures.push(`${path}: missing ${label}`);
  return text;
}

function mustNotContain(path, re, label) {
  const text = readFileSync(resolve(ROOT, path), 'utf-8');
  if (re.test(text)) failures.push(`${path}: forbidden ${label}`);
  return text;
}

// 1. Runtime sources are pinned.
mustContain('apps/mobile/lib/sentry.ts', /process\.env\.EXPO_PUBLIC_SENTRY_DSN/, 'mobile runtime EXPO_PUBLIC_SENTRY_DSN');
mustContain('apps/web/sentry.client.config.ts', /process\.env\.NEXT_PUBLIC_SENTRY_DSN/, 'web client NEXT_PUBLIC_SENTRY_DSN');

// 2. Mobile workflow must use dedicated mobile secret for runtime DSN.
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-mobile.yml'), 'utf-8');
const runtimeMappings = [...workflow.matchAll(/EXPO_PUBLIC_SENTRY_DSN:\s*\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
if (runtimeMappings.length === 0) {
  failures.push('.github/workflows/deploy-mobile.yml: no EXPO_PUBLIC_SENTRY_DSN mapping found');
} else {
  for (const secret of runtimeMappings) {
    if (secret !== 'EXPO_PUBLIC_SENTRY_DSN') {
      failures.push(`.github/workflows/deploy-mobile.yml: EXPO_PUBLIC_SENTRY_DSN mapped from secrets.${secret}, expected secrets.EXPO_PUBLIC_SENTRY_DSN`);
    }
  }
}

// 3. Server DSN must never feed mobile runtime (explicit divergence guard).
if (/EXPO_PUBLIC_SENTRY_DSN:\s*\$\{\{\s*secrets\.SENTRY_DSN\s*\}\}/.test(workflow)) {
  failures.push('.github/workflows/deploy-mobile.yml: mobile runtime fed by server secrets.SENTRY_DSN (use secrets.EXPO_PUBLIC_SENTRY_DSN)');
}

if (failures.length > 0) {
  console.error(`check-sentry-consistency: ${failures.length} failure(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log('check-sentry-consistency: OK');
