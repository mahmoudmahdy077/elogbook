const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check templates
  const templates = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,tenant_id`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templateData = await templates.json();
  console.log('Templates:', templateData.length);
  templateData.forEach(t => console.log(`  - ${t.name} (tenant: ${t.tenant_id})`));
  
  // Check existing cases
  const cases = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id,status&limit=5`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const caseData = await cases.json();
  console.log('\nCases:', caseData.length);
  caseData.forEach(c => console.log(`  - ${c.id.slice(0, 8)} status: ${c.status}`));
  
  // Try to submit a case
  if (caseData.length > 0) {
    const draft = caseData.find(c => c.status === 'draft');
    if (draft) {
      console.log('\nTrying to submit case:', draft.id.slice(0, 8));
      const submit = await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${draft.id}`, {
        method: 'PATCH',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ status: 'pending' })
      });
      const submitData = await submit.json();
      console.log('Submit result:', submit.status);
      if (submit.status === 200) {
        console.log('Case submitted successfully!');
      } else {
        console.log('Error:', submitData);
      }
    } else {
      console.log('\nNo draft cases to submit');
    }
  }
}

test().catch(e => console.error('Error:', e));
