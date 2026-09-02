#!/usr/bin/env node
// Gate E — PHI-claim guard: no marketing surface may contain HIPAA claims until Phase 4.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname, '..');
const patterns = [/hipaa-compliant/i, /hipaa compliant/i, /\bSOC\s*2\b/i];
const allowlist = [
  'docs/compliance', // compliance documentation exempt
  'PRODUCTION_UPGRADE_PLAN.md', // design doc is not marketing
  'scripts/verify-phi-claim.mjs',
];
function walk(dir,out=[]) {
  for(const e of readdirSync(dir)){const p=join(dir,e);const s=statSync(p);if(s.isDirectory()){if(e==='node_modules'||e==='.next'||e==='.git')continue;walk(p,out)}else if(/\.(tsx?|md|mdx)$/.test(p)) out.push(p)}
  return out;
}
const marketing = [
  join(ROOT,'apps/web/app/page.tsx'),
  join(ROOT,'apps/web/app/(marketing)'),
  join(ROOT,'README.md'),
];
let failed=[];
for(const base of marketing){
  try{
    const st=statSync(base);
    const files=st.isDirectory()?walk(base):[base];
    for(const f of files){
      if(allowlist.some(a=>f.includes(a))) continue;
      const src=readFileSync(f,'utf8');
      for(const re of patterns) if(re.test(src)) failed.push({file:f.replace(ROOT+'/',''),match:re.source});
    }
  }catch{}
}
if(failed.length){
  console.error('Gate E FAILED: PHI claim found in marketing surface (HIPAA/SOC2) before Phase 4');
  for(const f of failed) console.error(`  ${f.file} matches ${f.match}`);
  process.exit(1);
}else console.log('Gate E passed: no PHI claims in marketing');
