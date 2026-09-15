#!/usr/bin/env node
/**
 * N8 — EAS build provenance verifier (fail-closed).
 *
 * Binds the EXACT build invocation outputs to this candidate: for each
 * platform build JSON (from `eas build --json`), asserts finished status,
 * matching git commit, matching app/runtime version from apps/mobile/app.json,
 * and a present signed-artifact URL. Writes build IDs + URLs for the
 * download step. A generic "latest finished build" listing is NOT accepted.
 *
 * Usage: node scripts/verify-eas-provenance.mjs <android.json> <ios.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.argv[1] ?? '.', '..', '..');
const [androidPath, iosPath] = process.argv.slice(2);
if (!androidPath || !iosPath) {
  console.error('usage: node scripts/verify-eas-provenance.mjs <android.json> <ios.json>');
  process.exit(2);
}

const commit = readFileSync(resolve(ROOT, 'source-commit.txt'), 'utf-8').trim();
const appJson = JSON.parse(readFileSync(resolve(ROOT, 'apps/mobile/app.json'), 'utf-8'));
const expectedVersion = appJson.expo.version;
const expectedSlug = appJson.expo.slug;

const failures = [];
const ids = [];

for (const [label, path, platform] of [
  ['android', androidPath, 'ANDROID'],
  ['ios', iosPath, 'IOS'],
]) {
  let builds;
  try {
    builds = JSON.parse(readFileSync(resolve(path), 'utf-8'));
  } catch (err) {
    failures.push(`${label}: unreadable build JSON (${err.message})`);
    continue;
  }
  const list = Array.isArray(builds) ? builds : [builds];
  if (list.length !== 1) {
    failures.push(`${label}: expected exactly one build record, got ${list.length}`);
    continue;
  }
  const b = list[0];
  if (b.status !== 'FINISHED') failures.push(`${label}: status is ${b.status}, not FINISHED`);
  if (b.platform !== platform) failures.push(`${label}: platform is ${b.platform}, expected ${platform}`);
  if (b.gitCommitHash && b.gitCommitHash !== commit) {
    failures.push(`${label}: gitCommitHash ${b.gitCommitHash} != candidate ${commit}`);
  }
  if (!b.gitCommitHash) failures.push(`${label}: no gitCommitHash recorded (cannot bind to candidate)`);
  if (b.appVersion && b.appVersion !== expectedVersion) {
    failures.push(`${label}: appVersion ${b.appVersion} != app.json ${expectedVersion}`);
  }
  const url = b.artifacts?.buildUrl ?? b.artifactUrl ?? null;
  if (!url) failures.push(`${label}: no signed-artifact URL in build record`);
  if (!b.id) failures.push(`${label}: no build ID in build record`);
  else ids.push(`${label.toUpperCase()}_BUILD_ID=${b.id}`);
  if (url) ids.push(`${label.toUpperCase()}_ARTIFACT_URL=${url}`);
  const slug = b.appId ?? b.slug ?? '';
  if (slug && slug !== expectedSlug && !String(slug).includes(expectedSlug)) {
    failures.push(`${label}: app slug ${slug} != ${expectedSlug}`);
  }
}

if (failures.length > 0) {
  console.error(`verify-eas-provenance: ${failures.length} failure(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

writeFileSync(resolve(ROOT, 'build-ids.env'), `${ids.join('\n')}\n`);
console.log('verify-eas-provenance: OK');
for (const line of ids) {
  if (line.includes('BUILD_ID')) console.log(line);
}
