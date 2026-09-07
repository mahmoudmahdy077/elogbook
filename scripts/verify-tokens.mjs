#!/usr/bin/env node
// T21 token-drift gate: packages/shared clinicalTokens is authoritative;
// apps/web/app/globals.css @theme must mirror it. Any drift fails the gate
// instead of silently forking the palette.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const norm = (v) => v.trim().toLowerCase();
const failures = [];
const check = (name, actual, expected) => {
  if (norm(actual ?? '') !== norm(expected ?? '')) {
    failures.push(`${name}: css=${actual} tokens=${expected}`);
  } else {
    console.log(`tokens: ${name} ${actual} — ok`);
  }
};

const tokensSrc = readFileSync(join(ROOT, 'packages/shared/src/constants/design-tokens.ts'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'apps/web/app/globals.css'), 'utf8');

const tokenValue = (re) => tokensSrc.match(re)?.[1];
const cssValue = (name) => cssSrc.match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1];

// clinicalTokens colors.X -> css --color-X
check('primary', cssValue('primary'), tokenValue(/primary:\s*\{\s*DEFAULT:\s*'([^']+)'/));
check('backdrop', cssValue('backdrop'), tokenValue(/backdrop:\s*\{\s*dark:\s*'([^']+)'/));
check(
  'text-muted',
  cssValue('text-muted'),
  tokenValue(/muted:\s*'([^']+)'/),
);
check('pending', cssValue('pending'), tokenValue(/pending:\s*'([^']+)'/));
check('approved', cssValue('approved'), tokenValue(/approved:\s*'([^']+)'/));
check('rejected', cssValue('rejected'), tokenValue(/rejected:\s*'([^']+)'/));

if (failures.length) {
  console.error('verify-tokens FAILED: palette drift (tokens are authoritative):');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('verify-tokens passed: css mirrors clinicalTokens');
