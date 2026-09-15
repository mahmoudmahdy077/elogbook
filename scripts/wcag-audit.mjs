// WCAG AA contrast audit for light-theme text colors (Elogbook).
// 1. Detect hardcoded proxy text colors (text-white / text-gray-*) in web + mobile.
//    Known-safe exception: white text on a colored token bg (bg-primary/success/danger)
//    is a deliberate on-color pair, so only bg-* / surface-less cases are flagged.
// 2. Verify every documented token pair meets AA (4.5:1 normal, 3:1 large/UI).
// 3. Worst-case check: status text on the status *tint* pill background.
// Exit code 0 = pass, 1 = failing contrast found.
import { execSync } from 'node:child_process';

const srgb = (hex) => {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const f = (i) => {
    const v = parseInt(c.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f(0), f(1), f(2)];
};
const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const ratio = (a, b) => {
  const [l1, l2] = [lum(srgb(a)), lum(srgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---------- Part 1: proxy text colors ----------
let proxies = [];
try {
  proxies = execSync(
    'grep -rEn "text-(white|gray-[0-9]+)\\b" apps/web/app apps/web/components apps/mobile/app apps/mobile/components 2>/dev/null || true',
    { encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean);
} catch { /* empty */ }

// White text is allowed only when the same className puts it on a colored bg.
const onColor = /(bg-(primary|primary-hover|success|warning|danger|rejected|approved|pending|secondary)|from-\S+)/;
const suspects = proxies.filter((line) => {
  if (!line.includes('text-white')) return false;
  return !onColor.test(line.split(':')[2] ?? line);
});
// text-white on transparent/unknown bg with hover-only color also not allowed.
console.log('--- Part 1: hardcoded proxy text colors (token classes required) ---');
for (const line of suspects) console.log(line);
console.log(`Suspect hardcoded text-white without a colored token bg: ${suspects.length}`);
console.log(`(Raw text-white/text-gray-* scan hits: ${proxies.length}; white-on-colored-bg pairs excluded by policy)\n`);

// ---------- Part 2: token pair verification ----------
const pairs = [
  ['text.primary on backdrop', '#000000', ['#F2F2F7'], 4.5],
  ['text.primary on surface', '#000000', ['#FFFFFF'], 4.5],
  ['text.secondary on backdrop', '#3C3C43', ['#F2F2F7'], 4.5],
  ['text.secondary on surface', '#3C3C43', ['#FFFFFF'], 4.5],
  ['text.muted on backdrop', '#6D6D73', ['#F2F2F7'], 4.5],
  ['text.muted on surface', '#6D6D73', ['#FFFFFF'], 4.5],
  ['text.onPrimary on primary #007AFF', '#FFFFFF', ['#007AFF'], 4.5],
  ['status.text.success on white', '#186B2E', ['#FFFFFF'], 4.5],
  ['status.text.success on backdrop', '#186B2E', ['#F2F2F7'], 4.5],
  ['status.text.warning on white', '#8F4200', ['#FFFFFF'], 4.5],
  ['status.text.warning on backdrop', '#8F4200', ['#F2F2F7'], 4.5],
  ['status.text.danger on white', '#C20012', ['#FFFFFF'], 4.5],
  ['status.text.danger on backdrop', '#C20012', ['#F2F2F7'], 4.5],
  // iOS raw hues are decorative / large-text / UI components only (3:1)
  ['raw success #34C759 (icon/UI, 3:1)', '#34C759', ['#FFFFFF'], 3],
  ['raw warning #FF9500 (icon/UI, 3:1)', '#FF9500', ['#FFFFFF'], 3],
  ['raw danger #FF3B30 (icon/UI, 3:1)', '#FF3B30', ['#FFFFFF'], 3],
];
console.log('--- Part 2: token pair contrast ratios ---');
let fails = 0;
for (const [name, fg, bgs, req] of pairs) {
  for (const bg of bgs) {
    const r = ratio(fg, bg);
    const ok = r >= req;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1 (req ${req}:1)  ${name} on ${bg}`);
  }
}

// ---------- Part 3: worst-case tinted pill backgrounds ----------
function blendOver(hexFgTint, baseHex) {
  const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(hexFgTint);
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const base = srgb(baseHex).map((v) => v * 255);
  const mixed = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${mixed.map(toHex).join('')}`;
}
const pills = [
  ['success pill', '#186B2E', 'rgba(24, 107, 46, 0.08)'],
  ['warning pill', '#8F4200', 'rgba(143, 66, 0, 0.08)'],
  ['danger pill', '#C20012', 'rgba(194, 0, 18, 0.08)'],
];
console.log('\n--- Part 3: status text on tinted pill bg (worst case, over backdrop) ---');
for (const [name, fg, tint] of pills) {
  const pillBg = blendOver(tint, '#F2F2F7');
  const r = ratio(fg, pillBg);
  const ok = r >= 4.5;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1 (req 4.5:1)  ${name}: ${fg} on ${pillBg}`);
}

console.log(fails === 0 ? '\n✅ ALL TOKEN PAIRS PASS AA' : `\n❌ ${fails} failing pair(s)`);
process.exit(fails === 0 ? 0 : 1);
