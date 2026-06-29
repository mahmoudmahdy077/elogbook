#!/usr/bin/env node
/**
 * Boot-time environment check.
 *
 * Verifies that all required environment variables are present and that
 * none of them contain obvious secrets-in-code red flags. Run this at
 * the top of your entry point (next.config.js, edge function bootstrap)
 * to fail fast on missing config.
 *
 * Usage:
 *   node scripts/check-env.mjs            # check production defaults
 *   node scripts/check-env.mjs --strict    # also check all optional vars
 *
 * Exit codes:
 *   0 — all required vars present
 *   1 — at least one required var missing
 *   2 — placeholder value detected
 */
import process from 'node:process';

const REQUIRED = {
  server: [
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
  client: [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ],
};

const OPTIONAL = [
  'NEXT_PUBLIC_SITE_URL',
  'APP_ENCRYPTION_KEY',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const PLACEHOLDERS = [
  'your-',
  'sk_test_xxx',
  'whsec_xxx',
  '<set-me>',
  '<',
  '>',
  'change-me',
  'todo',
  'replace',
];

const strict = process.argv.includes('--strict');
const isProd = process.env.NODE_ENV === 'production';
const isEdge = typeof EdgeRuntime !== 'undefined';

let failed = false;

function checkVar(name, isRequired) {
  const v = process.env[name];
  if (!v || v.length === 0) {
    if (isRequired || (strict && OPTIONAL.includes(name))) {
      console.error(`[check-env] MISSING: ${name}`);
      failed = true;
    } else {
      console.warn(`[check-env] unset (optional): ${name}`);
    }
    return;
  }
  for (const ph of PLACEHOLDERS) {
    if (v.toLowerCase().includes(ph)) {
      console.error(`[check-env] PLACEHOLDER value in ${name}: "${v.slice(0, 12)}..."`);
      failed = true;
    }
  }
  if (isProd && (name.includes('KEY') || name.includes('SECRET'))) {
    if (v.length < 16) {
      console.error(`[check-env] ${name} is too short for production (${v.length} chars)`);
      failed = true;
    }
  }
}

const allVars = isEdge ? REQUIRED.client : [...REQUIRED.client, ...REQUIRED.server];
console.log(`[check-env] mode: ${isEdge ? 'edge' : 'server'} (${isProd ? 'production' : 'dev'})`);
for (const v of allVars) checkVar(v, true);
for (const v of OPTIONAL) checkVar(v, false);

if (failed) {
  console.error('[check-env] Environment check FAILED');
  process.exit(1);
}
console.log('[check-env] OK');
