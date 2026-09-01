import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
const consoleMsgs = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) consoleMsgs.push(m.type().toUpperCase() + ': ' + m.text().slice(0, 200));
});

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(5000);

const dom = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].map((i) => ({ id: i.id, name: i.name, type: i.type }));
  const buttons = [...document.querySelectorAll('button')].map((b) => ({
    type: b.type, text: b.textContent.trim().slice(0, 40), disabled: b.disabled,
  }));
  const forms = document.querySelectorAll('form').length;
  return { inputs, buttons, forms, url: location.href, title: document.title };
});
console.log(JSON.stringify(dom, null, 1));
console.log('--- page errors:', errors.length ? errors : 'none');
console.log('--- console:', consoleMsgs.length ? consoleMsgs.slice(0, 8) : 'none');
await browser.close();
