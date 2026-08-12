import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { sanitizeQuery, checkSafety } from './index.ts';

Deno.test('sanitizeQuery strips control characters and truncates', () => {
  assertEquals(sanitizeQuery('  hello\x00 world  '), 'hello world');
  assertEquals(sanitizeQuery('x'.repeat(2000)).length, 1000);
});

Deno.test('checkSafety flags diagnosis/prescription/prognosis patterns', () => {
  const flags = checkSafety('The patient is diagnosed with diabetes and we recommend medication');
  assertEquals(flags.includes('blocked_diagnosis'), true);
});
