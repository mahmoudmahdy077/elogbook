#!/usr/bin/env node
// Gate G — single client-IP derivation (necessary, not sufficient)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(import.meta.dirname,'..');
function walk(dir,out=[]){
 for(const e of readdirSync(dir)){const p=join(dir,e);const s=statSync(p);if(s.isDirectory()){if(['node_modules','.next','.git'].includes(e))continue;walk(p,out)}else if(p.endsWith('.ts')||p.endsWith('.js')) out.push(p);}
 return out;
}
const files=walk(join(ROOT,'apps/web'));
let readers=[];
let helperExists=false;
for(const f of files){
 if(f.includes('__tests__')) continue;
 const src=readFileSync(f,'utf8');
 if(src.includes('x-forwarded-for')){
   readers.push(f.replace(ROOT+'/',''));
   const norm = f.replace(/\\/g,'/');
   if(norm.endsWith('lib/client-ip.ts')) helperExists=true;
 }
}
if(readers.length!==1 || !helperExists){
  console.error(`Gate G FAILED: expected exactly 1 reader (lib/client-ip.ts), found ${readers.length}:`);
  for(const r of readers) console.error(`  ${r}`);
  process.exit(1);
}
// Check helper consults trust boundary
const helperSrc=readFileSync(join(ROOT,'apps/web/lib/client-ip.ts'),'utf8');
if(!helperSrc.includes('TRUSTED_PROXY_HOPS') && !helperSrc.includes('trustedProxy')){
  console.error('Gate G FAILED: helper must consult TRUSTED_PROXY_HOPS/trustedProxy');
  process.exit(1);
}
// Check test coverage for spoofing cases
const testSrc=readFileSync(join(ROOT,'apps/web/lib/__tests__/client-ip.test.ts'),'utf8');
const requiredCases=[
  'hops=0',
  'hops=1',
  'hops=2',
];
let missing=[];
for(const c of requiredCases) if(!testSrc.includes(c)) missing.push(c);
if(missing.length){
  console.error('Gate G FAILED: test matrix missing cases:',missing.join(', '));
  process.exit(1);
}
console.log('Gate G passed: single reader (lib/client-ip.ts), trust boundary consulted, test matrix present');
