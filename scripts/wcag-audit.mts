/* WCAG AA contrast audit for E-Logbook light theme.
 * Usage: npx tsx scripts/wcag-audit.mts  (from repo root)
 * - Recomputes contrast ratios for every clinicalTokens color pair used as text-on-surface.
 * - Prints a table and exits 1 if any listed pair falls below its required threshold.
 */
import { clinicalTokens } from '../packages/shared/src/constants/design-tokens.ts';

function lum(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  // composite alpha fg over bg when fg is rgba()
  if (fg.startsWith('rgba')) {
    const m = fg.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
    if (!m) throw new Error(`bad color ${fg}`);
    const [, r, g, b, a] = m;
    const bm = bg.replace('#', '');
    const bgc = [0, 2, 4].map((i) => parseInt(bm.slice(i, i + 2), 16));
    const comp = [r, g, b].map((c, i) => Math.round(+c * +a + bgc[i] * (1 - +a)));
    fg = '#' + comp.map((c) => c.toString(16).padStart(2, '0')).join('');
  }
  const l1 = lum(fg), l2 = lum(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#FFFFFF', GRAYF7 = '#F2F2F7';
const t = clinicalTokens.colors;

// text color × surfaces it appears on, minimum acceptable ratio
const pairs: [string, string, string[], number][] = [
  ['text.primary', t.text.primary, [WHITE, GRAYF7], 4.5],
  ['text.secondary', t.text.secondary, [WHITE, GRAYF7], 4.5],
  ['text.muted', t.text.muted, [WHITE, GRAYF7], 4.5],
  ['text.onPrimary', t.text.onPrimary, [t.primary.DEFAULT], 4.5],
  ['primary.DEFAULT', t.primary.DEFAULT, [WHITE], 4.5],
  ['status.text.draft', t.status.text.draft, [WHITE, GRAYF7], 4.5],
  ['status.text.success', t.status.text.success, [WHITE, GRAYF7], 4.5],
  ['status.text.warning', t.status.text.warning, [WHITE, GRAYF7], 4.5],
  ['status.text.danger', t.status.text.danger, [WHITE, GRAYF7], 4.5],
  // status text on its own tint bg (composite the tint over white — worst case)
  ['text on status bg success', t.status.text.success,
    ['#' + 'FFFFFF'], 4.5], // checked again via tint-composite below
];

const tintComposite = (rgba: string, over = WHITE) => {
  if (!rgba.startsWith('rgba')) return rgba;
  const m = rgba.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
  const [, r, g, b, a] = m;
  const bm = over.replace('#', '');
  const bgc = [0, 2, 4].map((i) => parseInt(bm.slice(i, i + 2), 16));
  const comp = [r, g, b].map((c, i) => Math.round(+c * +a + bgc[i] * (1 - +a)));
  return '#' + comp.map((c) => c.toString(16).padStart(2, '0')).join('');
};

// status text on its own tint bg (tint composited over white — worst case)
const statusBgPairs: [string, string, string, number][] = [
  ['status.text.success on success bg', t.status.text.success, t.status.bg.success as string, 4.5],
  ['status.text.warning on warning bg', t.status.text.warning, t.status.bg.warning as string, 4.5],
  ['status.text.danger on danger bg', t.status.text.danger, t.status.bg.danger as string, 4.5],
];

let fail = 0;
const rows: string[] = [];
for (const [name, fg, bgs, min] of pairs) {
  for (const bg of bgs) {
    const r = ratio(tintComposite(fg), bg);
    const ok = r >= min;
    if (!ok) fail++;
    rows.push(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  ${name} on ${bg}`);
  }
}
for (const [name, fg, bg, min] of statusBgPairs) {
  const r = ratio(tintComposite(fg), tintComposite(bg));
  const ok = r >= min;
  if (!ok) fail++;
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  ${name} (tint composited on white)`);
}
// disabled/muted large-text extras (informational)
rows.push(`INFO  ${ratio(t.deidentified.DEFAULT, WHITE).toFixed(2)}:1  deidentified on white`);

console.log(rows.join('\n'));
if (fail) { console.error(`\n${fail} pair(s) below 4.5:1`); process.exit(1); }
console.log('\nAll audited text pairs meet WCAG AA (≥4.5:1).');
