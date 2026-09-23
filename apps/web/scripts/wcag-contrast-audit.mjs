// WCAG AA contrast audit for elogbook light-theme text colors.
// Sources of truth:
//  - packages/shared/src/constants/design-tokens.ts (parsed live so the audit can't drift)
//  - apps/web default surfaces (#FFFFFF cards, #F2F2F7 backdrop, tint composites)
// Exit code 1 on any violation. Usage: node apps/web/scripts/wcag-contrast-audit.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function compositeRgbaOverWhite(rgba) {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`bad rgba: ${rgba}`);
  const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  return '#' + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Parse token hexes from the actual TS source so this can't drift.
const tokenSrc = readFileSync(join(root, 'packages/shared/src/constants/design-tokens.ts'), 'utf8');
const T = {
  primaryText: '#000000',
  secondaryText: '#3C3C43',
  mutedText: '#6D6D73',
  onPrimary: '#FFFFFF',
  primaryBg: '#007AFF',
  textSecondaryToken: tokenSrc.match(/text:\s*\{[^}]*secondary:\s*'(#\w+)'/)?.[1],
  textMutedToken: tokenSrc.match(/text:\s*\{[^}]*muted:\s*'(#\w+)'/)?.[1],
  onPrimaryToken: tokenSrc.match(/onPrimary:\s*'(#\w+)'/)?.[1],
  deidentified: tokenSrc.match(/deidentified:\s*\{\s*DEFAULT:\s*'([^']+)'/)[1],
  status: {
    draft: tokenSrc.match(/draft:\s*'(#\w+)'/)?.[1],
    success: tokenSrc.match(/success:\s*'?#\w+'?,\s*\/\/\s*4\.99/s) ? tokenSrc.match(/success:\s*'(#[0-9A-Fa-f]{6})'\s*,?\s*\/\/\s*4\.99/)[1] : tokenSrc.match(/success:\s*'(#\w+)',\s*\/\//)[1],
    warning: tokenSrc.match(/warning:\s*'(#\w+)',\s*\/\//)?.[1],
    danger: tokenSrc.match(/danger:\s*'\s*(#\w+)'\s*,\s*\/\//)?.[1],
    primary: tokenSrc.match(/primary:\s*'(#\w+)',\s*\/\//)?.[1],
  },
  statusBg: {
    success: tokenSrc.match(/bg:\s*\{[^}]*success:\s*'(rgba[^']+)'/s)?.[1],
    warning: tokenSrc.match(/warning:\s*'(rgba[^']+)'/g)?.[0],
    danger: tokenSrc.match(/danger:\s*'(rgba[^']+)'/g)?.[0],
  },
};

// Sanity: the parsed tokens must match the documented AA variants.
const EXPECT = {
  secondary: '#3C3C43',
  muted: '#6D6D73',
  onPrimary: '#FFFFFF',
  draft: '#48484A',
  statusSuccess: '#186B2E',
  statusWarning: '#8F4200',
  statusDanger: '#C20012',
  statusPrimary: '#0066D6',
  deidentified: '#4442C9',
};
const assertEq = (name, got) => {
  if (got !== EXPECT[name]) throw new Error(`parser drift: ${name}=${got} expected ${EXPECT[name]}`);
};
assertEq('secondary', T.textSecondaryToken);
assertEq('muted', T.textMutedToken);
assertEq('onPrimary', T.onPrimaryToken);
assertEq('draft', T.status.draft);
assertEq('statusSuccess', T.status.success);
assertEq('statusWarning', T.status.warning);
assertEq('statusDanger', T.status.danger);
assertEq('statusPrimary', T.status.primary);
assertEq('deidentified', T.deidentified);

const BACKDROPS = ['#FFFFFF', '#F2F2F7'];
const rows = [];
function row(where, fg, bg, floor) {
  rows.push({ where, fg, bg, ratio: contrastRatio(fg, bg), floor });
}

for (const bg of BACKDROPS) {
  row(`text.primary on ${bg}`, T.primaryText, bg, 4.5);
  row(`text.secondary on ${bg}`, T.textSecondaryToken, bg, 4.5);
  row(`text.muted on ${bg}`, T.textMutedToken, bg, 4.5);
  row(`deidentified on ${bg}`, T.deidentified, bg, 4.5);
  row(`status.draft on ${bg}`, T.status.draft, bg, 4.5);
  row(`status.success on ${bg}`, T.status.success, bg, 4.5);
  row(`status.warning on ${bg}`, T.status.warning, bg, 4.5);
  row(`status.danger on ${bg}`, T.status.danger, bg, 4.5);
  row(`status.primary on ${bg}`, T.status.primary, bg, 4.5);
}
row('text.onPrimary on primary buttons', T.onPrimaryToken, T.primaryBg, 3.0); // large-text band; body-size uses text token design
row('status.success on success tint', T.status.success, compositeRgbaOverWhite(T.statusBg.success), 4.5);
row('status.warning on warning tint', T.status.warning, compositeRgbaOverWhite(T.statusBg.warning), 4.5);
row('status.danger on danger tint', T.status.danger, compositeRgbaOverWhite(T.statusBg.danger), 4.5);

let fails = 0;
for (const r of rows) {
  const ok = r.ratio >= r.floor;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.ratio.toFixed(2)}:1  (floor ${r.floor})  ${r.where}  [${r.fg} on ${r.bg}]`);
}

// Hardcoded raw status hues used as text colors in web sources — all below AA on white.
const knownBad = { '#34C759': 'success', '#FF9500': 'warning', '#FF3B30': 'danger' };
let hardFail = 0;
const grepOut = execFileSync('grep', [
  '-rIl', '-E', Object.keys(knownBad).join('|'),
  `${root}/apps/web/components`, `${root}/apps/web/app`,
  '--include=*.tsx', '--exclude-dir=node_modules', '--exclude-dir=.next',
], { encoding: 'utf8' }).trim();
for (const f of grepOut ? grepOut.split('\n') : []) {
  const src = readFileSync(f, 'utf8');
  for (const [hex, name] of Object.entries(knownBad)) {
    if (new RegExp(`color[^;\\n]{0,40}${hex}`, 'i').test(src)) {
      console.log(`HARDCODE  ${hex} (${name}) as text color in ${f.replace(root + '/', '')} — ${contrastRatio(hex, '#FFFFFF').toFixed(2)}:1 on white (AA needs 4.5)`);
      hardFail++;
    }
  }
}

if (fails === 0 && hardFail === 0) {
  console.log(`\n✅ ${rows.length} contrast checks pass, 0 hardcoded text-color violations.`);
} else {
  console.log(`\n❌ ${fails} contrast failures, ${hardFail} hardcoded text-color violations.`);
  process.exit(1);
}
