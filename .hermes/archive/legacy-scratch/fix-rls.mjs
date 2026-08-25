const URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function run() {
  // Login as platform admin
  const loginRes = await fetch(URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await loginRes.json();
  console.log('Logged in as platform admin');

  // Check if exec_sql RPC exists
  const checkRes = await fetch(URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'SELECT 1' })
  });
  console.log('exec_sql check:', checkRes.status);
  
  if (!checkRes.ok) {
    console.log('exec_sql not available, trying direct SQL via postgrest...');
    // Try querying case_entries to verify current state
    const verifyRes = await fetch(URL + '/rest/v1/case_entries?select=id,status&limit=5', {
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token }
    });
    const entries = await verifyRes.json();
    console.log('Current case entries:', JSON.stringify(entries));
    
    // Try to update a case status to test RLS
    if (entries.length > 0) {
      const testId = entries[0].id;
      const updateRes = await fetch(URL + '/rest/v1/case_entries?id=eq.' + testId, {
        method: 'PATCH',
        headers: { 
          'apikey': KEY, 
          'Authorization': 'Bearer ' + access_token, 
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ status: 'pending' })
      });
      console.log('Update test:', updateRes.status, await updateRes.text());
    }
    return;
  }

  // Fix 1: RLS case submission
  console.log('\n--- Fix 1: RLS case submission ---');
  let res = await fetch(URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "DROP POLICY IF EXISTS \"residents update own draft or rejected entries\" ON public.case_entries" })
  });
  console.log('Drop old policy:', res.status, await res.text());

  res = await fetch(URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `CREATE POLICY "residents update own draft or rejected entries" ON public.case_entries FOR UPDATE TO authenticated USING (resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()) AND tenant_id = get_tenant_id() AND status IN ('draft', 'rejected') AND deleted_at IS NULL) WITH CHECK (resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()) AND tenant_id = get_tenant_id() AND status IN ('draft', 'pending'))` })
  });
  console.log('Create new policy:', res.status, await res.text());

  // Fix 2: Global templates visibility
  console.log('\n--- Fix 2: Global templates visibility ---');
  res = await fetch(URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "DROP POLICY IF EXISTS \"Tenant members can read templates\" ON public.case_templates" })
  });
  console.log('Drop template policy:', res.status, await res.text());

  res = await fetch(URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `CREATE POLICY "Tenant members can read templates" ON case_templates FOR SELECT TO authenticated USING (tenant_id = get_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000000')` })
  });
  console.log('Create template policy:', res.status, await res.text());
  
  console.log('\nAll fixes applied!');
}

run().catch(e => console.error('Error:', e));
