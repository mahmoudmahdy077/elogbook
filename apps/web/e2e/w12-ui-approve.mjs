// W12 final v2: approve pending rows (close slide-over between), verify webhook delivery
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const Hs={'apikey':SRK,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const WID='fec65687-ac20-4a86-b3fb-24eb0ce54aa3';
(async()=>{
 const before=await fetch(SB+'/rest/v1/tenant_webhook_deliveries?webhook_id=eq.'+WID,{headers:Hs}).then(r=>r.json());
 const beforeCount=Array.isArray(before)?before.length:0;
 console.log('deliveries BEFORE:',beforeCount);
 const S=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'supervisor@demo.com',password:'password123!'})}).then(r=>r.json());
 const ref=SB.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)[1];
 const tokenValue=JSON.stringify({access_token:S.access_token,refresh_token:S.refresh_token,expires_in:S.expires_in??3600,expires_at:S.expires_at??Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:S.user});
 const browser=await chromium.launch();
 const ctx=await browser.newContext();
 await ctx.addCookies([{name:`sb-${ref}-auth-token`,value:'base64-'+Buffer.from(tokenValue).toString('base64'),url:'https://elogbook-web.vercel.app',httpOnly:false,sameSite:'Lax'}]);
 const page=await ctx.newPage();
 await page.goto('https://elogbook-web.vercel.app/demo/approvals',{waitUntil:'networkidle'});
  page.on('response',r=>{if(r.url().includes('approvals/action'))console.log('[net]',r.status(),r.request().method(),'->',r.headers()['location']??'',(r.headers()['x-matched-path']??''))});
 for(let row=1;row<=4;row++){
   const views=page.getByText('View',{exact:true});
   if(await views.count()===0){console.log('row',row,'no rows left');break}
   await views.first().click();
   await page.waitForTimeout(1200);
   const ap=page.getByRole('button',{name:/^approve$/i});
   if(await ap.count()===0){await page.keyboard.press('Escape');await page.waitForTimeout(600);continue}
   await ap.first().click();
   await page.waitForTimeout(2500);
   await page.keyboard.press('Escape');
   await page.waitForTimeout(800);
 }
 await page.waitForTimeout(7000); // allow after() dispatch
 const after=await fetch(SB+'/rest/v1/tenant_webhook_deliveries?webhook_id=eq.'+WID,{headers:Hs}).then(r=>r.json());
 const afterCount=Array.isArray(after)?after.length:0;
 console.log('deliveries AFTER:',afterCount,afterCount>beforeCount?'*** WEBHOOK DELIVERED ✓':'still none');
 if(afterCount>beforeCount) console.log(JSON.stringify(after));
 await browser.close();
})()



