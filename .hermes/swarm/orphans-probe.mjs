import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const H={'apikey':SRK,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6';
async function count(q){const r=await fetch(`${SB}/rest/v1/${q}`,{headers:H}).then(x=>x.json());return Array.isArray(r)?r.length:'ERR:'+JSON.stringify(r).slice(0,80)}
(async()=>{
 // FK-enforced orphans can't exist where FK constraints exist; these checks target soft-ref tables:
 console.log('[comments w/o live case]', await count(`case_comments?select=id&tenant_id=eq.${TENANT}&case_id=not.in.(select id from case_entries)&limit=5`).catch?.(()=>0)||'?');
})()
