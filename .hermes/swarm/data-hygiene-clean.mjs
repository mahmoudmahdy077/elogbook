import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={'apikey':SRK,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6';
const PATTERNS=['*cycle*','*swarm*','*probe*','*PERF-AUDIT*','*wave3*','*bisect*','*rpc-sd*','*w3-storage*','*pol-*','*F2PROBE*','*secmatrix*','*cap*','*exp5*','*exp6*','*x1*','*x2*','*ab1*','*ab2*','*full-error*','*ORCA*'];
(async()=>{
 let removed=0;
 for(const pat of PATTERNS){
   const rows=await fetch(`${SB}/rest/v1/case_entries?tenant_id=eq.${TENANT}&field_values->>procedure_name=ilike.${pat}&select=id,procedure_codes`,{headers:H}).then(r=>r.json());
   for(const row of rows||[]){
     const d=await fetch(`${SB}/rest/v1/case_entries?id=eq.${row.id}`,{method:'DELETE',headers:H});
     if(d.ok)removed++;
   }
 }
 console.log('test-pattern rows removed:',removed);
 // final counts
 const q=await fetch(`${SB}/rest/v1/rpc/check_case_quota`,{method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
 console.log('final quota:',JSON.stringify(q));
 const remainingLive=await fetch(`${SB}/rest/v1/case_entries?tenant_id=eq.${TENANT}&deleted_at=is.null&select=id,field_values`,{headers:H}).then(r=>r.json());
 console.log('live rows remaining:',remainingLive.length,'names:',remainingLive.map(r=>r.field_values?.procedure_name).join(', ').slice(0,140));
})()
