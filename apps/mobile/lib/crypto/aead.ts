/**
 * Authenticated encryption for PHI-at-rest on the device: AES-256-CBC + HMAC-SHA-256
 * in an Encrypt-then-MAC construction (the "Secret Box" envelope).
 *
 * Replaces the previous crypto-js dependency with a dependency-free, audited,
 * test-vector-verified implementation. `node` tests cross-check every vector
 * against Node's `crypto` AES-256-CBC and HMAC-SHA-256.
 *
 * Envelope (hex-encoded string):
 *   [ version:1 | iv:16 | tag:32 | ciphertext:n ]  (all big-endian hex)
 *
 * Integrity is guaranteed by MAC-over-(iv||ciphertext): a single corrupted or
 * tampered byte fails the tag check before any decryption is attempted.
 */

import {
  cbcEncrypt,
  cbcDecrypt,
  bytesToHex,
  hexToBytes,
} from './aes256';
import { sha256, hmacSha256 } from './sha256';

const VERSION = 0x01;
const IV_LEN = 16;
const KEY_LEN = 32;
const TAG_LEN = 32;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Derive two independent 32-byte subkeys (AES + MAC) from the 32-byte master key.
 * Domain-separated so the two keys can never be equal.
 */
export function deriveKeys(masterKey: Uint8Array): { aesKey: Uint8Array; macKey: Uint8Array } {
  if (masterKey.length !== KEY_LEN) throw new CryptoError('master key must be 32 bytes');
  const aesKey = sha256(concatBytes(masterKey, new TextEncoder().encode('elogbook:aes:v1')));
  const macKey = sha256(concatBytes(masterKey, new TextEncoder().encode('elogbook:mac:v1')));
  return { aesKey, macKey };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Random 16-byte IV. Injectable `randomBytes` (default uses a CSPRNG) for tests.
 */
export function getRandomIv(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): Uint8Array {
  return randomBytes(IV_LEN);
}

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // globalThis.crypto.getRandomValues is available in Hermes, Node >=19, and browsers.
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(out);
    return out;
  }
  // CRITICAL: Math.random() is NOT cryptographically secure.
  // Throw an error instead of silently using a weak RNG.
  throw new Error(
    '[Crypto] No CSPRNG available (globalThis.crypto.getRandomValues). ' +
    'Cannot generate secure random bytes. Ensure you are running on a ' +
    'supported platform (Hermes, Node >=19, or modern browser).',
  );
}

/**
 * Encrypt + authenticate `plaintext` with `masterKeyBytes` (32 bytes -> 64 hex chars).
 * Returns the hex-encoded envelope string.
 */
export function encryptText(masterKeyBytes: Uint8Array, plaintext: string): string {
  const { aesKey, macKey } = deriveKeys(masterKeyBytes);
  const iv = getRandomIv();
  const ct = cbcEncrypt(aesKey, iv, new TextEncoder().encode(plaintext));
  // MAC over (iv || ciphertext)
  const macInput = concatBytes(iv, ct);
  const tag = hmacSha256(macKey, macInput);
  // assemble envelope
  const env = new Uint8Array(1 + IV_LEN + TAG_LEN + ct.length);
  env[0] = VERSION;
  env.set(iv, 1);
  env.set(tag, 1 + IV_LEN);
  env.set(ct, 1 + IV_LEN + TAG_LEN);
  return bytesToHex(env);
}

/**
 * Verify MAC and decrypt. Throws `CryptoError` on tamper / wrong key / bad version.
 */
export function decryptText(masterKeyBytes: Uint8Array, envelopeHex: string): string {
  const env = safeHexBytes(envelopeHex);
  if (env.length < 1 + IV_LEN + TAG_LEN + 16) throw new CryptoError('invalid envelope length');
  if (env[0] !== VERSION) throw new CryptoError('unsupported envelope version');
  const iv = env.subarray(1, 1 + IV_LEN);
  const tag = env.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = env.subarray(1 + IV_LEN + TAG_LEN);

  const { aesKey, macKey } = deriveKeys(masterKeyBytes);
  const macInput = concatBytes(iv, ct);
  const expected = hmacSha256(macKey, macInput);
  if (!constantTimeEqual(tag, expected)) {
    throw new CryptoError('MAC verification failed: data was tampered with or key is wrong');
  }
  const pt = cbcDecrypt(aesKey, iv, ct);
  return new TextDecoder().decode(pt);
}

function safeHexBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) {
    throw new CryptoError('invalid envelope encoding');
  }
  try {
    return hexToBytes(hex);
  } catch {
    throw new CryptoError('invalid envelope encoding');
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
