import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import {
  cbcEncrypt,
  cbcDecrypt,
  hexToBytes,
  bytesToHex,
} from '../aes256';
import { sha256, hmacSha256 } from '../sha256';
import {
  encryptText,
  decryptText,
  deriveKeys,
  getRandomIv,
  CryptoError,
} from '../aead';

// ---------------------------------------------------------------------------
// AES-256 block cipher / CBC vs node:crypto
// ---------------------------------------------------------------------------
describe('aes256 cbc vs node:crypto', () => {
  it('round-trips the same vectors as node AES-256-CBC', () => {
    for (let i = 0; i < 200; i++) {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const ptLen = Math.floor(Math.random() * 128);
      const pt = crypto.randomBytes(ptLen);

      // Node applies PKCS#7 padding on .final(); concatenate update+final.
      const ci = crypto.createCipheriv('aes-256-cbc', key, iv);
      const ciph = Buffer.concat([ci.update(pt), ci.final()]);

      const ours = cbcEncrypt(
        Uint8Array.from(key),
        Uint8Array.from(iv),
        Uint8Array.from(pt),
      );
      expect(bytesToHex(ours)).toBe(ciph.toString('hex'));

      const dec = cbcDecrypt(
        Uint8Array.from(key),
        Uint8Array.from(iv),
        ours,
      );
      expect(bytesToHex(dec)).toBe(pt.toString('hex'));
    }
  });
});

// ---------------------------------------------------------------------------
// SHA-256 vs node
// ---------------------------------------------------------------------------
describe('sha256 vs node:crypto', () => {
  it('matches node for known + random inputs', () => {
    // Empty string
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // "abc"
    expect(bytesToHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (let i = 0; i < 200; i++) {
      const data = crypto.randomBytes(Math.floor(Math.random() * 200));
      const ours = sha256(Uint8Array.from(data));
      expect(bytesToHex(ours)).toBe(crypto.createHash('sha256').update(data).digest('hex'));
    }
  });

  it('hmac-sha256 matches node', () => {
    for (let i = 0; i < 100; i++) {
      const key = crypto.randomBytes(Math.floor(Math.random() * 70) + 1);
      const msg = crypto.randomBytes(Math.floor(Math.random() * 100));
      const ours = hmacSha256(Uint8Array.from(key), Uint8Array.from(msg));
      expect(bytesToHex(ours)).toBe(
        crypto.createHmac('sha256', key).update(msg).digest('hex'),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AEAD envelope
// ---------------------------------------------------------------------------
describe('elogbook aead secret box', () => {
  const master = Uint8Array.from(crypto.randomBytes(32));

  it('round-trips plaintext', () => {
    const env = encryptText(master, 'PHI: patient mrn SECRET');
    expect(env).not.toContain('SECRET');
    const dec = decryptText(master, env);
    expect(dec).toBe('PHI: patient mrn SECRET');
  });

  it('produces unique ciphertext per call (random IV)', () => {
    const a = encryptText(master, 'same');
    const b = encryptText(master, 'same');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext (MAC fails)', () => {
    const env = encryptText(master, 'important secret');
    const bytes = Uint8Array.from(hexToBytes(env));
    bytes[bytes.length - 1]! ^= 0x01; // flip one ciphertext byte
    const tampered = bytesToHex(bytes);
    expect(() => decryptText(master, tampered)).toThrow(CryptoError);
  });

  it('rejects a wrong key', () => {
    const env = encryptText(master, 'hello');
    const other = Uint8Array.from(crypto.randomBytes(32));
    expect(() => decryptText(other, env)).toThrow(CryptoError);
  });

  it('rejects truncated / malformed envelopes', () => {
    const env = encryptText(master, 'x');
    const truncated = env.slice(0, env.length - 20);
    expect(() => decryptText(master, truncated)).toThrow(CryptoError);
    expect(() => decryptText(master, 'zz')).toThrow(CryptoError);
  });

  it('derives distinct aes and mac keys', () => {
    const { aesKey, macKey } = deriveKeys(master);
    expect(bytesToHex(aesKey)).not.toBe(bytesToHex(macKey));
    expect(aesKey.length).toBe(32);
  });

  it('getRandomIv returns 16 unique bytes', () => {
    const a = getRandomIv();
    const b = getRandomIv();
    expect(a.length).toBe(16);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('large payload round-trips', () => {
    const big = 'p'.repeat(200_000);
    const env = encryptText(master, big);
    expect(decryptText(master, env)).toBe(big);
  });
});
