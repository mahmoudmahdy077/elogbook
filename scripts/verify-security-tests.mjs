#!/usr/bin/env node
// Gate D — security tests cannot vanish silently
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gateDPaths, loadTestInventory } from './verify-test-inventory.mjs';
const ROOT = join(import.meta.dirname,'..');
const inventory = loadTestInventory();
const requiredSuites = gateDPaths(inventory, 'suite');
const requiredDatabaseSuites = gateDPaths(inventory, 'database');
let failed=false;
function fail(message){
  console.error(`Gate D FAILED: ${message}`);
  failed=true;
}
for(const rel of requiredSuites){
  const p=join(ROOT,rel);
  try{
    const st=statSync(p);
    if(st.size===0) throw new Error('empty');
    const src=readFileSync(p,'utf8');
    if(src.includes('.skip(') || src.includes('describe.skip') || src.includes('it.skip')){
      fail(`suite ${rel} contains skipped tests`);
    }
    if(!src.includes('expect(')){
      fail(`suite ${rel} has no assertions`);
    }
    console.log(`Gate D: ${rel} present (${st.size} bytes)`);
  }catch(e){
    fail(`required suite missing or empty: ${rel} — ${e.message}`);
  }
}
const databaseRoot=join(ROOT,'supabase','tests');
try{
  const discovered=readdirSync(databaseRoot,{withFileTypes:true})
    .filter((entry)=>entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry)=>`supabase/tests/${entry.name}`);
  for(const rel of discovered.filter((rel)=>!requiredDatabaseSuites.includes(rel))){
    fail(`maintained database suite is not in the protected inventory: ${rel}`);
  }
}catch(e){
  fail(`maintained database suite inventory unreadable — ${e.message}`);
}
try{
  const workflow=readFileSync(join(ROOT,'.github','workflows','ci.yml'),'utf8');
  const workflowDatabaseSuites=[...workflow.matchAll(/^[ \t]+(supabase\/tests\/[^\s]+[.]sql)[ \t]*\\?[ \t]*$/gm)]
    .map((match)=>match[1]);
  const sameLength=workflowDatabaseSuites.length===requiredDatabaseSuites.length;
  const sameOrder=sameLength && workflowDatabaseSuites.every((rel,index)=>rel===requiredDatabaseSuites[index]);
  if(!sameOrder){
    const missing=requiredDatabaseSuites.filter((rel)=>!workflowDatabaseSuites.includes(rel));
    const unexpected=workflowDatabaseSuites.filter((rel)=>!requiredDatabaseSuites.includes(rel));
    fail(`CI db-test inventory differs from the protected inventory (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}; expected order: ${requiredDatabaseSuites.join(' ')})`);
  }
}catch(e){
  fail(`CI db-test inventory unreadable — ${e.message}`);
}
const assertionPattern=/^[ \t]*SELECT[ \t]+(isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim;
for(const rel of requiredDatabaseSuites){
  const p=join(ROOT,...rel.split('/'));
  try{
    const st=statSync(p);
    if(st.size===0) throw new Error('empty');
    const src=readFileSync(p,'utf8');
    const planMatch=src.match(/^[ \t]*SELECT[ \t]+plan[ \t]*\([ \t]*(\d+)[ \t]*\)[ \t]*;/im);
    if(!planMatch || Number(planMatch[1])===0){
      fail(`database suite ${rel} has no positive pgTAP plan`);
    }else{
      const planned=Number(planMatch[1]);
      const assertions=[...src.matchAll(assertionPattern)].length;
      if(assertions!==planned){
        fail(`database suite ${rel} has ${assertions} top-level assertions but plans ${planned}`);
      }
    }
    if(/^[ \t]*SELECT[ \t]+(?:skip|todo)[ \t]*\(/im.test(src) || /\b(?:no_plan|skip|todo)[ \t]*\(/i.test(src) || /\bRAISE[ \t]+NOTICE[ \t]+'SKIP\b/i.test(src)){
      fail(`database suite ${rel} contains a skipped or todo assertion`);
    }
    if(!/^[ \t]*BEGIN[ \t]*;/im.test(src) || !/ROLLBACK[ \t]*;[ \t]*$/im.test(src)){
      fail(`database suite ${rel} is not transaction-wrapped`);
    }
    console.log(`Gate D: ${rel} present (${st.size} bytes)`);
  }catch(e){
    fail(`required database suite missing or empty: ${rel} — ${e.message}`);
  }
}
if(failed) process.exit(1);
console.log('Gate D passed: all required security suites and database inventories are present, ordered, planned, and not skipped');
