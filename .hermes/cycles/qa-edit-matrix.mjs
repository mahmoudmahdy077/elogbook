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
const D=await login('director@demo.com');
const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hd={'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
const j=r=>r.json();
const rprof=await fetch(URL+'/rest/v1/profiles?select=id&user_id=eq.'+R.user.id,{headers:Hr}).then(j);
const sprof=await fetch(URL+'/rest/v1/profiles?select=id&user_id=eq.'+S.user.id,{headers:Hs}).then(j);
console.log('rprof',rprof[0].id);
const tmpl=await fetch(URL+'/rest/v1/case_templates?select=id&tenant_id=in.('+TENANT+',00000000-0000-0000-0000-000000000000)&limit=1',{headers:Hr}).then(j);
const tid=tmpl[0].id;
// ensure quota headroom
let qq=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
if(qq[0] && !qq[0].allowed){
  const oldest=await fetch(URL+'/rest/v1/case_entries?select=id&tenant_id=eq.'+TENANT+'&deleted_at=is.null&order=created_at.asc&limit=3',{headers:Hr}).then(j);
  for(const row of (Array.isArray(oldest)?oldest:[])) await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:row.id})}).then(j).catch(()=>null);
}
// Create cases in each status: draft, pending, approved, rejected
async function mk(status){
  const ins=await fetch(URL+'/rest/v1/case_entries?select=id,status',{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rprof[0].id,template_id:tid,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'qa-'+status+'-'+Date.now()},status,accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:33,patient_hash:'qa-'+status})}).then(j);
  const id=Array.isArray(ins)?ins[0]?.id:null;
  console.log('mk '+status, JSON.stringify(ins).slice(0,120), id);
  return id;
}
const draftId=await mk('draft');
const pendingId=await mk('pending');
// for approved: mk pending then approve
let approvedId=null;
if(pendingId){
  // create another pending to approve
  const tmp=await mk('pending');
  const sSub=JSON.parse(Buffer.from(S.access_token.split('.')[1],'base64url').toString());
  const ap=await fetch(URL+'/rest/v1/rpc/approve_case',{method:'POST',headers:Hs,body:JSON.stringify({p_entry_id:tmp,p_supervisor_id:sSub.sub})}).then(j);
  console.log('approve tmp',JSON.stringify(ap));
  approvedId=tmp;
}
const rejectedId=await mk('pending').then(async id=>{
  if(!id) return null;
  const sSub=JSON.parse(Buffer.from(S.access_token.split('.')[1],'base64url').toString());
  const rj=await fetch(URL+'/rest/v1/rpc/reject_case',{method:'POST',headers:Hs,body:JSON.stringify({p_entry_id:id,p_supervisor_id:sSub.sub,p_comment:'qa reject'})}).then(j);
  console.log('reject',JSON.stringify(rj));
  const chk=await fetch(URL+'/rest/v1/case_entries?select=status&id=eq.'+id,{headers:Hr}).then(j);
  console.log('rejected chk',JSON.stringify(chk));
  return id;
});

console.log('IDs', {draftId, approvedId, rejectedId, pendingId});

async function tryPatch(id, headers, payload, label){
  const before=await fetch(URL+'/rest/v1/case_entries?select=field_values,status&id=eq.'+id,{headers}).then(j);
  const res=await fetch(URL+'/rest/v1/case_entries?id=eq.'+id,{method:'PATCH',headers,body:JSON.stringify(payload)});
  const txt=await res.text();
  const after=await fetch(URL+'/rest/v1/case_entries?select=field_values,status&id=eq.'+id,{headers}).then(j);
  const changed=JSON.stringify(before)!==JSON.stringify(after);
  console.log(label+' -> status'+res.status+' ok='+res.ok+' changed='+changed+' body='+txt.slice(0,160)+' before='+JSON.stringify(before).slice(0,80)+' after='+JSON.stringify(after).slice(0,80));
  return {status:res.status, ok:res.ok, changed, txt};
}

console.log('\\n--- Resident edit matrix ---');
if(draftId) await tryPatch(draftId, Hr, {field_values:{procedure_name:'res-edit-draft'}}, 'RES edit DRAFT field_values');
if(pendingId) await tryPatch(pendingId, Hr, {field_values:{procedure_name:'res-edit-pending'}}, 'RES edit PENDING field_values');
if(approvedId) await tryPatch(approvedId, Hr, {field_values:{procedure_name:'res-edit-approved'}}, 'RES edit APPROVED field_values');
if(rejectedId) await tryPatch(rejectedId, Hr, {field_values:{procedure_name:'res-edit-rejected'}}, 'RES edit REJECTED field_values');
if(draftId) await tryPatch(draftId, Hr, {status:'pending'}, 'RES draft->pending');
if(rejectedId) await tryPatch(rejectedId, Hr, {status:'draft'}, 'RES rejected->draft (resubmit)');
if(approvedId) await tryPatch(approvedId, Hr, {status:'pending'}, 'RES approved->pending (should fail)');

console.log('\\n--- Supervisor edit matrix ---');
if(draftId){
  // draft may now be pending if previous test changed it; re-fetch status
  const st=await fetch(URL+'/rest/v1/case_entries?select=status&id=eq.'+draftId,{headers:Hs}).then(j);
  console.log('draft current status before sup tests',JSON.stringify(st));
  await tryPatch(draftId, Hs, {field_values:{procedure_name:'sup-edit-draft'}}, 'SUP edit DRAFT field_values');
}
if(pendingId) await tryPatch(pendingId, Hs, {field_values:{procedure_name:'sup-edit-pending'}}, 'SUP edit PENDING field_values');
if(pendingId) await tryPatch(pendingId, Hs, {status:'approved'}, 'SUP pending->approved via PATCH (direct)');
if(approvedId) await tryPatch(approvedId, Hs, {field_values:{procedure_name:'sup-edit-approved'}}, 'SUP edit APPROVED field_values');
if(rejectedId) await tryPatch(rejectedId, Hs, {field_values:{procedure_name:'sup-edit-rejected'}}, 'SUP edit REJECTED field_values');

console.log('\\n--- Soft-delete matrix ---');
async function softDel(id, headers, label){
  const res=await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers,body:JSON.stringify({p_entry_id:id})}).then(j);
  console.log(label, JSON.stringify(res).slice(0,140));
  return res;
}
if(draftId) await softDel(draftId, Hr, 'RES soft_del draft');
if(approvedId) {
  // try resident soft delete approved (should succeed via RPC, resident own)
  const id2=await mk('draft'); // create fresh draft to test approved path
  // make pending then approve then resident soft delete
  const sSub=JSON.parse(Buffer.from(S.access_token.split('.')[1],'base64url').toString());
  // pendingId2
  const pend = await mk('pending');
  await fetch(URL+'/rest/v1/rpc/approve_case',{method:'POST',headers:Hs,body:JSON.stringify({p_entry_id:pend,p_supervisor_id:sSub.sub})}).then(j);
  console.log('fresh approved id',pend);
  await softDel(pend, Hr, 'RES soft_del APPROVED (own)');
  await softDel(pend, Hr, 'RES soft_del APPROVED idempotent 2nd');
  // supervisor soft delete rejected
  if(rejectedId) {
    await softDel(rejectedId, Hs, 'SUP soft_del REJECTED');
    await softDel(rejectedId, Hs, 'SUP soft_del REJECTED idempotent 2nd');
  }
  // resident try to soft delete someone else? cross-resident not possible in demo tenant single resident, so test cross-tenant guard: try soft_delete with fake id
  const fake='00000000-0000-0000-0000-000000000099';
  await softDel(fake, Hr, 'RES soft_del NOT_FOUND fake');
  // quota headroom
  const q1=await fetch(URL+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:Hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
  console.log('quota after soft_deletes',JSON.stringify(q1));
}

 // cleanup leftovers
for(const id of [draftId, pendingId, approvedId, rejectedId].filter(Boolean)){
  await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:id})}).then(j).catch(()=>null);
}
// also cleanup any other qa- ids
const qaRows=await fetch(URL+'/rest/v1/case_entries?select=id&tenant_id=eq.'+TENANT+'&patient_hash=like.qa-%25&deleted_at=is.null',{headers:Hr}).then(j);
console.log('remaining qa rows',JSON.stringify(qaRows).slice(0,200));
for(const row of (Array.isArray(qaRows)?qaRows:[])){
  await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:row.id})}).then(j).catch(()=>null);
}
console.log('matrix cleanup done');
