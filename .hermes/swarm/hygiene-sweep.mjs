import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={'apikey':SRK,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6';
(async()=>{
 const q=async(table,query)=>{const r=await fetch(`${SB}/rest/v1/${table}?${query}`,{headers:H}).then(x=>x.json());return Array.isArray(r)?r.length:'ERR'};
 console.log('live cases (non-demo-named):', await q('case_entries',`tenant_id=eq.${TENANT}&deleted_at=is.null&field_values->>procedure_name=neq.Appendectomy&select=id`));
 // probe-name sweep across recent test patterns
 for (const pat of ['*cycle*','*swarm*','*probe*','*PERF-AUDIT*','*wave*','*bisect*','*cap*','*exp*']) {
   const n = await q('case_entries',`tenant_id=eq.${TENANT}&field_values->>procedure_name=ilike.${pat}&select=id`);
   if (n>0) console.log(`LEFTOVER case_entries procedure_name ilike ${pat}: ${n}`);
 }
 const goals=await fetch(`${SB}/rest/v1/program_goals?tenant_id=eq.${TENANT}&select=id,title`,{headers:H}).then(r=>r.json());
 const strayGoals=(goals||[]).filter(g=>/cycle|swarm|probe|wave|full-error/i.test(g.title));
 console.log('goals:',goals.length,'| stray:',strayGoals.map(g=>g.title).join(',')||'none');
 if(strayGoals.length){for(const g of strayGoals)await fetch(`${SB}/rest/v1/program_goals?id=eq.${g.id}`,{method:'DELETE',headers:H});console.log('stray goals deleted')}
 const hooks=await fetch(`${SB}/rest/v1/tenant_webhooks?tenant_id=eq.${TENANT}&select=id`,{headers:H}).then(r=>r.json());
 console.log('webhooks remaining:',hooks.length);
 const evals=await fetch(`${SB}/rest/v1/evaluation_forms?tenant_id=eq.${TENANT}&select=id`,{headers:H}).then(r=>r.json());
 console.log('evaluation_forms remaining:',evals.length);
 console.log('hygiene sweep complete');
})()
