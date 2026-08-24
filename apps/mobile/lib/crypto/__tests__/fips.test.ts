import { describe, it, expect } from 'vitest';
import * as nodecrypto from 'node:crypto';
import { keyExpansion, encryptBlock, hexToBytes, bytesToHex, cbcEncrypt, cbcDecrypt } from '../aes256';

describe('fips-197 aes-128', () => {
  it('round keys w0-w15 match FIPS-197 Appendix A.1', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const w = keyExpansion(key);
    const got = w.slice(0,16).map(x=>(x>>>0).toString(16).padStart(8,'0'));
    const expected = [
      '00010203','04050607','08090a0b','0c0d0e0f',
      'd6aa74fd','d2af72fa','daa678f1','d6ab76fe',
      'b692cf0b','643dbdf1','be9bc500','6830b3fe',
      'b6ff744e','d2c2c9bf','6c590cbf','0469bf41'
    ];
    expect(got).toEqual(expected);
  });
  it('cipher output matches FIPS-197 Appendix B', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const pt = hexToBytes('00112233445566778899aabbccddeeff');
    const enc = encryptBlock(pt, keyExpansion(key), 10);
    expect(bytesToHex(enc)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });
  it('aes-256 cipher output matches FIPS-197', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const pt = hexToBytes('00112233445566778899aabbccddeeff');
    const enc = encryptBlock(pt, keyExpansion(key), 14);
    expect(bytesToHex(enc)).toBe('8ea2b7ca516745bfeafc49904b496089');
  });
  it('cbc round-trip vs node:crypto (200 random vectors)', () => {
    for (let i = 0; i < 200; i++) {
      const key = nodecrypto.randomBytes(32);
      const iv = nodecrypto.randomBytes(16);
      const pt = nodecrypto.randomBytes(Math.floor(Math.random()*128));
      const ci = nodecrypto.createCipheriv('aes-256-cbc', key, iv);
      const ciph = Buffer.concat([ci.update(pt), ci.final()]);
      const ours = cbcEncrypt(Uint8Array.from(key), Uint8Array.from(iv), Uint8Array.from(pt));
      expect(bytesToHex(ours)).toBe(ciph.toString('hex'));
      const dec = cbcDecrypt(Uint8Array.from(key), Uint8Array.from(iv), ours);
      expect(bytesToHex(dec)).toBe(pt.toString('hex'));
    }
  });
});
