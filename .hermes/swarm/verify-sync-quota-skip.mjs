import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const login=async(e)=>fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,2500));
const H={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const prof=(await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:H}).then(r=>r.json()))[0];
const tmpl=(await fetch(`${URL}/rest/v1/case_templates?select=id&tenant_id=eq.00000000-0000-0000-0000-000000000000&limit=1`,{headers:H}).then(r=>r.json()))[0];
const q=()=>fetch(`${URL}/rest/v1/rpc/check_case_quota`,{method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
let st=(await q())[0]; console.log('quota start:',st.current_count,'/',st.max_cases);
// fill to cap
const ids=[];
while((await q())[0].current_count < 20){
  const row={id:crypto.randomUUID(),tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'wave2-fill'},status:'approved',accreditation_mappings:[],is_deidentified:true};
  const res=await fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:H,body:JSON.stringify({p_table_name:'case_entries',p_rows:[row]})});
  if(!res.ok){console.log('fill stopped at',ids.length,await res.text());break}
  ids.push(row.id);
}
console.log('filled to:',(await q())[0].current_count,'| rows created:',ids.length);
// THE TEST: 3-row batch while at cap -> expect 200 with affected=0, NOT 500
const batch=[0,1,2].map(()=>({id:crypto.randomUUID(),tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'overflow'},status:'approved',accreditation_mappings:[],is_deidentified:true}));
const res=await fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:H,body:JSON.stringify({p_table_name:'case_entries',p_rows:batch})});
console.log('overflow batch status:',res.status,res.ok?'(no exception ✓)':await res.text());
if(res.ok) console.log('affected returned:',await res.json());
// cleanup everything we made
for(const id of [...ids,...batch.map(b=>b.id)]) await fetch(`${URL}/rest/v1/case_entries?id=eq.${id}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
console.log('cleanup done, quota now:',(await q())[0].current_count);
