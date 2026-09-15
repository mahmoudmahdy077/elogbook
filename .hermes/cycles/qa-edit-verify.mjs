import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const R=await login('resident@demo.com');
const S=await login('supervisor@demo.com');
const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const j=r=>r.json();
const rprof=await fetch(URL+'/rest/v1/profiles?select=id&user_id=eq.'+R.user.id,{headers:Hr}).then(j);
const sprof=await fetch(URL+'/rest/v1/profiles?select=id&user_id=eq.'+S.user.id,{headers:Hs}).then(j);
console.log('rprof',rprof[0].id,'sprof',sprof[0].id);
const tmpl=await fetch(URL+'/rest/v1/case_templates?select=id&tenant_id=in.('+TENANT+',00000000-0000-0000-0000-000000000000)&limit=1',{headers:Hr}).then(j);
console.log('tmpl',tmpl[0]?.id);
let qq=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
console.log('quota before',JSON.stringify(qq));
if(qq[0] && !qq[0].allowed){
  const oldest=await fetch(URL+'/rest/v1/case_entries?select=id&tenant_id=eq.'+TENANT+'&deleted_at=is.null&order=created_at.asc&limit=2',{headers:Hr}).then(j);
  for(const row of (Array.isArray(oldest)?oldest:[])) await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:row.id})}).then(j).catch(()=>null);
  qq=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
  console.log('quota after evict',JSON.stringify(qq));
}
let ins=await fetch(URL+'/rest/v1/case_entries?select=id,status',{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rprof[0].id,template_id:tmpl[0].id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'qa-draft-'+Date.now()},status:'draft',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:33,patient_hash:'qa-hash'})}).then(j);
console.log('draft ins',JSON.stringify(ins));
const draftId=Array.isArray(ins)?ins[0]?.id:null;
let ins2=await fetch(URL+'/rest/v1/case_entries?select=id,status',{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rprof[0].id,template_id:tmpl[0].id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'qa-pending-'+Date.now()},status:'pending',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:33,patient_hash:'qa-hash'})}).then(j);
console.log('pending ins',JSON.stringify(ins2));
let pendingId=Array.isArray(ins2)?ins2[0]?.id:null;
if(pendingId){
  const sSub=JSON.parse(Buffer.from(S.access_token.split('.')[1], 'base64url').toString());
  const ap=await fetch(URL+'/rest/v1/rpc/approve_case',{method:'POST',headers:Hs,body:JSON.stringify({p_entry_id:pendingId,p_supervisor_id:sSub.sub,p_comment:'qa approve'})}).then(j);
  console.log('approve pending->approved',JSON.stringify(ap));
  const approvedId=ins2[0]?.id;
  const row=await fetch(URL+'/rest/v1/case_entries?select=id,status&id=eq.'+approvedId,{headers:Hr}).then(j);
  console.log('approved row',JSON.stringify(row));
  let insPending2=await fetch(URL+'/rest/v1/case_entries?select=id,status',{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rprof[0].id,template_id:tmpl[0].id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'qa-pending2-'+Date.now()},status:'pending',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:33,patient_hash:'qa-hash'})}).then(j);
  console.log('pending2 ins',JSON.stringify(insPending2));
  pendingId=Array.isArray(insPending2)?insPending2[0]?.id:null;
  if(draftId){
    const upd=await fetch(URL+'/rest/v1/case_entries?id=eq.'+draftId,{method:'PATCH',headers:Hr,body:JSON.stringify({field_values:{procedure_name:'qa-draft-edited'}})});
    console.log('resident edit own DRAFT status',upd.status, upd.ok? 'OK':'FAIL', (await upd.text()).slice(0,180));
    const chk=await fetch(URL+'/rest/v1/case_entries?select=field_values&id=eq.'+draftId,{headers:Hr}).then(j);
    console.log('draft after edit',JSON.stringify(chk));
  }
  if(approvedId){
    const before=await fetch(URL+'/rest/v1/case_entries?select=field_values&id=eq.'+approvedId,{headers:Hr}).then(j);
    const upd2=await fetch(URL+'/rest/v1/case_entries?id=eq.'+approvedId,{method:'PATCH',headers:Hr,body:JSON.stringify({field_values:{procedure_name:'qa-approved-edit-attempt'}})});
    const txt2=await upd2.text();
    console.log('resident edit APPROVED attempt',upd2.status, txt2.slice(0,180));
    const after=await fetch(URL+'/rest/v1/case_entries?select=field_values&id=eq.'+approvedId,{headers:Hr}).then(j);
    console.log('approved before vs after equal?', JSON.stringify(before)===JSON.stringify(after), JSON.stringify(before), JSON.stringify(after));
    const upd3=await fetch(URL+'/rest/v1/case_entries?id=eq.'+approvedId,{method:'PATCH',headers:Hs,body:JSON.stringify({field_values:{procedure_name:'sup-edit-approved'}})});
    const txt3=await upd3.text();
    console.log('supervisor edit APPROVED attempt',upd3.status, txt3.slice(0,180));
    const after2=await fetch(URL+'/rest/v1/case_entries?select=field_values&id=eq.'+approvedId,{headers:Hs}).then(j);
    console.log('supervisor edit approved persisted?',JSON.stringify(after2));
    if(pendingId){
      const bef=await fetch(URL+'/rest/v1/case_entries?select=field_values,status&id=eq.'+pendingId,{headers:Hs}).then(j);
      console.log('pending bef',JSON.stringify(bef));
      const upd4=await fetch(URL+'/rest/v1/case_entries?id=eq.'+pendingId,{method:'PATCH',headers:Hs,body:JSON.stringify({field_values:{procedure_name:'sup-edit-pending'}})});
      const txt4=await upd4.text();
      console.log('supervisor edit PENDING field_values only',upd4.status, txt4.slice(0,180));
      const aft=await fetch(URL+'/rest/v1/case_entries?select=field_values,status&id=eq.'+pendingId,{headers:Hs}).then(j);
      console.log('pending aft',JSON.stringify(aft));
      const upd5=await fetch(URL+'/rest/v1/case_entries?id=eq.'+pendingId,{method:'PATCH',headers:Hr,body:JSON.stringify({field_values:{procedure_name:'res-edit-pending'}})});
      const txt5=await upd5.text();
      console.log('resident edit PENDING attempt',upd5.status, txt5.slice(0,180));
      const aft2=await fetch(URL+'/rest/v1/case_entries?select=field_values&id=eq.'+pendingId,{headers:Hr}).then(j);
      console.log('resident edit pending persisted?',JSON.stringify(aft2), 'equal to aft?', JSON.stringify(aft)===JSON.stringify(aft2));
      if(draftId){
        const sub=await fetch(URL+'/rest/v1/case_entries?id=eq.'+draftId,{method:'PATCH',headers:Hr,body:JSON.stringify({status:'pending'})});
        const txtSub=await sub.text();
        console.log('resident draft->pending submit',sub.status, txtSub.slice(0,180));
        const chkSub=await fetch(URL+'/rest/v1/case_entries?select=status&id=eq.'+draftId,{headers:Hr}).then(j);
        console.log('draft after submit',JSON.stringify(chkSub));
      }
      const quotaBefore2=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
      console.log('quota before soft_delete',JSON.stringify(quotaBefore2));
      if(draftId){
        const sd1=await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:draftId})}).then(j);
        console.log('soft_delete 1st call',JSON.stringify(sd1));
        const sd2=await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:draftId})}).then(j);
        console.log('soft_delete 2nd idempotent',JSON.stringify(sd2));
      }
      const quotaAfter=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
      console.log('quota after soft_delete',JSON.stringify(quotaAfter));
      for(const id of [approvedId, pendingId].filter(Boolean)){
        const r=await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:id})}).then(j).catch(()=>null);
        console.log('cleanup '+id, JSON.stringify(r));
      }
      console.log('cleanup done');
    }
  }
}
