import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testLogin(email, password, role) {
  console.log(`\n=== Testing login: ${role} (${email}) ===`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  Console error:', msg.text());
  });
  
  page.on('requestfailed', req => {
    console.log('  Request failed:', req.url(), req.failure()?.errorText);
  });
  
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('  Login page loaded');
    
    await page.fill('input[type="email"], input[name="email"], input#email', email);
    console.log('  Email filled');
    
    await page.fill('input[type="password"], input[name="password"], input#password', password);
    console.log('  Password filled');
    
    await page.click('button[type="submit"]');
    console.log('  Submit clicked, waiting for navigation...');
    
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    console.log(`  SUCCESS: Redirected to ${page.url()}`);
    
    // Take screenshot
    await page.screenshot({ path: `G:\\elogbook\\apps\\web\\screenshots\\${role}-dashboard.png` });
    console.log('  Screenshot saved');
    
    return { success: true, url: page.url() };
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
    await page.screenshot({ path: `G:\\elogbook\\apps\\web\\screenshots\\${role}-error.png` });
    return { success: false, error: err.message };
  } finally {
    await browser.close();
  }
}

// Create screenshots dir
import { mkdirSync } from 'fs';
mkdirSync('G:\\elogbook\\apps\\web\\screenshots', { recursive: true });

const results = [];

// Test all demo accounts
const accounts = [
  { email: 'resident@demo.com', password: 'password123!', role: 'resident' },
  { email: 'supervisor@demo.com', password: 'password123!', role: 'supervisor' },
  { email: 'director@demo.com', password: 'password123!', role: 'director' },
  { email: 'admin@demo.com', password: 'password123!', role: 'institution_admin' },
  { email: 'platform@demo.com', password: 'password123!', role: 'platform_admin' },
];

for (const account of accounts) {
  const result = await testLogin(account.email, account.password, account.role);
  results.push({ ...account, ...result });
}

console.log('\n=== LOGIN TEST RESULTS ===');
for (const r of results) {
  console.log(`${r.role}: ${r.success ? 'PASS' : 'FAIL'} ${r.url || r.error || ''}`);
}

const allPassed = results.every(r => r.success);
console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
process.exit(allPassed ? 0 : 1);
