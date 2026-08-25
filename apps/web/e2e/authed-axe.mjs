/* global process, Buffer */
// Authenticated-page axe scan (Wave 6 Track D) — reuses e2e fixtures pattern
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref=SB.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)[1];
const s=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const tokenValue=JSON.stringify({access_token:s.access_token,refresh_token:s.refresh_token,expires_in:s.expires_in??3600,expires_at:s.expires_at??Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:s.user});
const BASE='http://localhost:3100';
const browser=await chromium.launch();
const ctx=await browser.newContext();
await ctx.addCookies([{name:`sb-${ref}-auth-token`,value:'base64-'+Buffer.from(tokenValue).toString('base64'),url:BASE,httpOnly:false,sameSite:'Lax'}]);
const page=await ctx.newPage();
for(const route of ['/demo/dashboard','/demo/cases','/demo/goals','/demo/reports']){
  await page.goto(BASE+route,{waitUntil:'networkidle'});
  const res=await new AxeBuilder({page}).analyze();
  const crit=res.violations.filter(v=>v.impact==='critical');
  console.log(route,'-> critical:',crit.length, crit.length?JSON.stringify(crit.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))):'');
}
await browser.close();
