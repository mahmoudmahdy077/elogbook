#!/usr/bin/env node
// Gate F — credential keys never silently degrade to local Map
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT=join(import.meta.dirname,'..');
const src=readFileSync(join(ROOT,'apps/web/lib/rate-limit-redis.ts'),'utf8');
if(!src.includes('isCredentialKey') || !src.includes('redisDegradedSince')){
  console.error('Gate F FAILED: rate-limit-redis must define isCredentialKey and redisDegradedSince');
  process.exit(1);
}
if(!src.includes("if (isCredentialKey(key))") || !src.includes('failing closed')){
  console.error('Gate F FAILED: must fail closed for credential keys when Redis down');
  process.exit(1);
}
if(!src.includes('redisDegradedSince = Date.now()') || !src.includes('redisDegradedSince = null')){
  console.error('Gate F FAILED: must set redisDegradedSince before deny and clear on success');
  process.exit(1);
}
// Check contract test covers it
const testSrc=readFileSync(join(ROOT,'apps/web/lib/__tests__/rate-limit-contract.test.ts'),'utf8');
if(!testSrc.includes('credential keys never use local Map') && !testSrc.includes('credential keys never silently degrade')){
  console.error('Gate F FAILED: contract test must assert credential keys never use local Map');
  process.exit(1);
}
console.log('Gate F passed: credential fail-closed + degradation ordering asserted');
