#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const apiRoot = join(root, 'apps', 'web', 'app', 'api');
const reviewedExemptions = new Map([
  ['apps/web/app/api/contact/route.ts', 'reviewed public contact endpoint with its dedicated rate and abuse controls'],
  ['apps/web/app/api/email/unsubscribe/route.ts', 'RFC 8058 one-click endpoint is form-urlencoded, read-only on GET, and requires an expiring signed body-free token'],
  ['apps/web/app/api/csp-violation/route.ts', 'reviewed browser CSP telemetry sink with non-JSON payload handling'],
  ['apps/web/app/api/platform/email/process/route.ts', 'cron secret authenticates a non-browser worker and does not accept browser JSON'],
  ['apps/web/app/api/setup/complete/route.ts', 'setup token, setup guard, durable lock, and no request body define this completion action'],
  ['apps/web/app/api/[tenant]/admin/plans/route.ts', 'POST/PUT/DELETE are unconditional 403 refusals: no request, no auth, no database client, no state change, fixed response body asserted by apps/web/lib/__tests__/billing-entitlement-authority.test.ts'],
  ['apps/web/app/api/[tenant]/admin/subscription/route.ts', 'PUT is an unconditional 409 refusal directing the caller to the payment portal; the tenant cannot self-activate entitlement, so there is no body to validate'],
  ['apps/web/app/api/[tenant]/admin/subscription/cancel/route.ts', 'POST is an unconditional 409 refusal; cancellation is provider-mediated via the billing portal and the webhook, so there is no body to validate'],
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...walk(path));
    else if (entry === 'route.ts') files.push(path);
  }
  return files;
}

function hasGuard(source) {
  return /from ['"]@\/lib\/http\/request-guard['"]/.test(source) &&
    /\b(?:guardRequest|readJsonBody|readRequestBody|withRequestGuard|guardRoute)\s*\(/.test(source);
}

function hasMutation(source) {
  return /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source) ||
    /export\s+const\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source);
}

function main() {
  const findings = [];
  for (const file of walk(apiRoot).sort()) {
    const source = readFileSync(file, 'utf8');
    if (!hasMutation(source)) continue;
    const path = relative(root, file).replaceAll('\\', '/');
    if (hasGuard(source) || reviewedExemptions.has(path)) continue;
    findings.push(path);
  }
  if (findings.length > 0) {
    for (const path of findings) console.log(`${path}:1:request-guard-missing-or-unreviewed`);
    process.exitCode = 1;
    return;
  }
  console.log('request-guard-coverage-pass');
}

main();
