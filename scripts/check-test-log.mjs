#!/usr/bin/env node
/**
 * N6 — test-log warning gate.
 *
 * Fails on unapproved runtime warning/error signatures in captured test
 * output. Suppression env vars (NODE_NO_WARNINGS,
 * VITE_CONFIG_NATIVE_IGNORE_WARNING) are banned — fix or classify instead.
 * Exactly one classified-allowed notice exists (vite-tsconfig-paths info);
 * everything else fails the gate. Raw logs are uploaded as CI artifacts.
 *
 * Usage: node scripts/check-test-log.mjs <logfile>
 */
import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-test-log.mjs <logfile>');
  process.exit(2);
}

const text = readFileSync(file, 'utf-8');
const lines = text.split('\n');

// Classified-expected (rationale documented, not suppression):
const ALLOW = [
  // Informational notice from Vite: the tsconfig-paths plugin is intentional
  // (web vitest needs @/* resolution); migration to native tsconfigPaths is
  // tracked separately and changes resolution behavior, so it stays.
  /vite-tsconfig-paths.*detected/i,
];

const DENY = [
  /configLoader/i,
  /features that are unsupported/i,
  /ExperimentalWarning/i,
  /DeprecationWarning/i,
  /UnhandledPromiseRejection/i,
  /unhandled rejection/i,
  /VITE_CONFIG_NATIVE_IGNORE_WARNING/i,
  /NODE_NO_WARNINGS/i,
  /\[patch-renderer\].*(not found|No .* found)/i,
];

const hits = [];
lines.forEach((line, i) => {
  if (ALLOW.some((re) => re.test(line))) return;
  const bad = DENY.find((re) => re.test(line));
  if (bad) hits.push(`${i + 1}: ${line.slice(0, 220)}`);
});

if (hits.length > 0) {
  console.error(`check-test-log: ${hits.length} unapproved warning/error line(s) in ${file}`);
  for (const h of hits.slice(0, 30)) console.error(` - ${h}`);
  process.exit(1);
}
console.log('check-test-log: OK');
