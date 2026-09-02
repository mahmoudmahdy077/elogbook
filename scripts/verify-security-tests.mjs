#!/usr/bin/env node
// Gate D — security tests cannot vanish silently
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname,'..');
const requiredSuites = [
  'apps/web/app/api/[tenant]/admin/users/__tests__/cross-tenant.test.ts',
  'apps/web/lib/__tests__/rate-limit-contract.test.ts',
  'apps/web/lib/__tests__/client-ip.test.ts',
  'apps/web/app/api/health/__tests__/route.test.ts',
  'apps/web/app/api/ready/__tests__/route.test.ts',
];
let failed=false;
for(const rel of requiredSuites){
  const p=join(ROOT,rel);
  try{
    const st=statSync(p);
    if(st.size===0) throw new Error('empty');
    const src=readFileSync(p,'utf8');
    if(src.includes('.skip(') || src.includes('describe.skip') || src.includes('it.skip')){
      console.error(`Gate D FAILED: suite ${rel} contains skipped tests`);
      failed=true;
    }
    if(!src.includes('expect(')){
      console.error(`Gate D FAILED: suite ${rel} has no assertions`);
      failed=true;
    }
    console.log(`Gate D: ${rel} present (${st.size} bytes)`);
  }catch(e){
    console.error(`Gate D FAILED: required suite missing or empty: ${rel} — ${e.message}`);
    failed=true;
  }
}
if(failed) process.exit(1);
console.log('Gate D passed: all required security suites present and not skipped');
