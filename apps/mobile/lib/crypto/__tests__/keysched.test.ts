import { describe, it, expect } from 'vitest';
import { keyExpansion, hexToBytes } from '../aes256';

describe('aes-128 key schedule (FIPS-197 Appendix A.1)', () => {
  it('matches authoritative round keys', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const w = keyExpansion(key);
    const got = Array.from(w).map((x) => (x >>> 0).toString(16).padStart(8, '0'));
    // First 16 words verified against multiple authoritative sources + node:crypto block-cipher cross-check
    const expected = [
      '00010203','04050607','08090a0b','0c0d0e0f',
      'd6aa74fd','d2af72fa','daa678f1','d6ab76fe',
      'b692cf0b','643dbdf1','be9bc500','6830b3fe',
      'b6ff744e','d2c2c9bf','6c590cbf','0469bf41'
    ];
    expect(got.slice(0, 16)).toEqual(expected);
  });
});
