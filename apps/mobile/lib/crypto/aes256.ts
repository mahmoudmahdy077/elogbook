/**
 * Pure-TypeScript AES-256 (FIPS-197) block cipher + CBC mode.
 *
 * Dependency-free so it runs on React Native Hermes where WebCrypto `crypto.subtle`
 * is unavailable. Correctness is verified in tests against Node's `crypto` module
 * over many random vectors + published FIPS-197 vectors.
 *
 * SECURITY NOTE: this is the block cipher primitive only. Use it through the
 * authenticated-encryption wrapper in `aead.ts` (AES-256-CBC + HMAC-SHA-256,
 * Encrypt-then-MAC). Never use bare CBC on its own.
 */

const S_BOX: number[] = [
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe,
  0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4,
  0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7,
  0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3,
  0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09,
  0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3,
  0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe,
  0x39, 0x4a, 0x4c, 0x58, 0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85,
  0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92,
  0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c,
  0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19,
  0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14,
  0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2,
  0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5,
  0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08, 0xba, 0x78, 0x25,
  0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86,
  0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e,
  0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
  0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

// precomputed inverse S-box
const INV_S_BOX: number[] = new Array(256).fill(0);
for (let i = 0; i < 256; i++) INV_S_BOX[S_BOX[i]] = i;

export function getSBox(): readonly number[] {
  return S_BOX;
}

// GF(2^8) multiply helper for MixColumns (xtime)
function xtime(a: number): number {
  return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

const ROUND_CONSTANTS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

/**
 * Expand a 16/24/32-byte key into the AES round-key schedule (one 16-byte round key
 * per round + initial). nk words, nr rounds.
 */
export function keyExpansion(key: Uint8Array): number[] {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error('AES requires a 16, 24, or 32-byte key');
  }
  const nk = key.length / 4; // 4, 6, or 8 words
  const nr = nk === 4 ? 10 : nk === 6 ? 12 : 14; // rounds
  const w: number[] = new Array(4 * (nr + 1)).fill(0);

  for (let i = 0; i < nk; i++) {
    w[i] = (key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!;
  }

  for (let i = nk; i < 4 * (nr + 1); i++) {
    let temp = w[i - 1]!;
    if (i % nk === 0) {
      // RotWord (rotate left one byte) + SubWord + Rcon
      const rc = ROUND_CONSTANTS[i / nk - 1]!;
      const rotated = ((temp << 8) | (temp >>> 24)) & 0xffffffff;
      temp =
        (S_BOX[(rotated >>> 24) & 0xff]! << 24) |
        (S_BOX[(rotated >>> 16) & 0xff]! << 16) |
        (S_BOX[(rotated >>> 8) & 0xff]! << 8) |
        S_BOX[rotated & 0xff]!;
      temp ^= rc << 24;
    } else if (nk === 8 && i % nk === 4) {
      // extra SubWord for 256-bit keys
      temp =
        (S_BOX[(temp >>> 24) & 0xff]! << 24) |
        (S_BOX[(temp >>> 16) & 0xff]! << 16) |
        (S_BOX[(temp >>> 8) & 0xff]! << 8) |
        S_BOX[temp & 0xff]!;
    }
    w[i] = (w[i - nk]! ^ temp) >>> 0;
  }
  return w;
}

function roundsForKey(key: Uint8Array): number {
  return key.length === 16 ? 10 : key.length === 24 ? 12 : 14;
}

/**
 * Encrypt a single 16-byte block under the expanded key schedule.
 */
export function encryptBlock(block: Uint8Array, w: number[], nr: number = 14): Uint8Array {
  const state = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) state[i] = block[i]!;

  // initial round key add
  addRoundKey(state, w, 0);

  for (let round = 1; round < nr; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, w, round);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, w, nr);

  return new Uint8Array(state);
}

/**
 * Decrypt a single 16-byte block under the expanded key schedule.
 */
export function decryptBlock(block: Uint8Array, w: number[], nr: number = 14): Uint8Array {
  const state = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) state[i] = block[i]!;

  addRoundKey(state, w, nr);
  for (let round = nr - 1; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, w, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, w, 0);

  return new Uint8Array(state);
}

function addRoundKey(state: number[], w: number[], round: number): void {
  const base = round * 4;
  for (let c = 0; c < 4; c++) {
    const kw = w[base + c]!;
    state[c * 4]! ^= (kw >>> 24) & 0xff;
    state[c * 4 + 1]! ^= (kw >>> 16) & 0xff;
    state[c * 4 + 2]! ^= (kw >>> 8) & 0xff;
    state[c * 4 + 3]! ^= kw & 0xff;
  }
}

function subBytes(state: number[]): void {
  for (let i = 0; i < 16; i++) state[i] = S_BOX[state[i]!]!;
}

function invSubBytes(state: number[]): void {
  for (let i = 0; i < 16; i++) state[i] = INV_S_BOX[state[i]!]!;
}

function shiftRows(state: number[]): void {
  // row 1: shift left 1, row 2: shift left 2, row 3: shift left 3
  const t = new Array(4).fill(0);
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) t[c] = state[r + 4 * c]!;
    for (let c = 0; c < 4; c++) state[r + 4 * c] = t[(c + r) % 4]!;
  }
}

function invShiftRows(state: number[]): void {
  const t = new Array(4).fill(0);
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) t[c] = state[r + 4 * c]!;
    for (let c = 0; c < 4; c++) state[r + 4 * c] = t[(c - r + 4) % 4]!;
  }
}

function mixColumns(state: number[]): void {
  for (let c = 0; c < 4; c++) {
    const a0 = state[0 + 4 * c]!;
    const a1 = state[1 + 4 * c]!;
    const a2 = state[2 + 4 * c]!;
    const a3 = state[3 + 4 * c]!;
    state[0 + 4 * c] = xtime(a0) ^ (a1 ^ xtime(a1)) ^ a2 ^ a3;
    state[1 + 4 * c] = a0 ^ xtime(a1) ^ (a2 ^ xtime(a2)) ^ a3;
    state[2 + 4 * c] = a0 ^ a1 ^ xtime(a2) ^ (a3 ^ xtime(a3));
    state[3 + 4 * c] = (a0 ^ xtime(a0)) ^ a1 ^ a2 ^ xtime(a3);
  }
}

function invMixColumns(state: number[]): void {
  for (let c = 0; c < 4; c++) {
    const a0 = state[0 + 4 * c]!;
    const a1 = state[1 + 4 * c]!;
    const a2 = state[2 + 4 * c]!;
    const a3 = state[3 + 4 * c]!;
    state[0 + 4 * c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    state[1 + 4 * c] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    state[2 + 4 * c] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    state[3 + 4 * c] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

// GF(2^8) multiplication
function gmul(a: number, b: number): number {
  let p = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) p ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return p;
}

const BLOCK = 16;

function pkcs7Pad(input: Uint8Array): Uint8Array {
  const padLen = BLOCK - (input.length % BLOCK);
  const out = new Uint8Array(input.length + padLen);
  out.set(input);
  out.fill(padLen, input.length);
  return out;
}

function pkcs7Unpad(input: Uint8Array): Uint8Array {
  if (input.length === 0 || input.length % BLOCK !== 0) {
    throw new Error('invalid ciphertext length');
  }
  const padLen = input[input.length - 1]!;
  if (padLen < 1 || padLen > BLOCK) throw new Error('invalid padding');
  return input.subarray(0, input.length - padLen);
}

function xorBlocks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

/**
 * AES-256-CBC encrypt. `iv` must be 16 bytes. Returns ciphertext (padded, includes
 * no IV — caller manages the IV separately).
 */
export function cbcEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 requires 32-byte key');
  if (iv.length !== 16) throw new Error('IV must be 16 bytes');
  const w = keyExpansion(key);
  const padded = pkcs7Pad(plaintext);
  const out = new Uint8Array(padded.length);
  let prev = iv;
  for (let i = 0; i < padded.length; i += BLOCK) {
    const block = padded.subarray(i, i + BLOCK);
    const xored = xorBlocks(block, prev);
    const enc = encryptBlock(xored, w);
    out.set(enc, i);
    prev = enc;
  }
  return out;
}

/**
 * AES-256-CBC decrypt.
 */
export function cbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 requires 32-byte key');
  if (iv.length !== 16) throw new Error('IV must be 16 bytes');
  if (ciphertext.length === 0 || ciphertext.length % BLOCK !== 0) {
    throw new Error('invalid ciphertext length');
  }
  const w = keyExpansion(key);
  const out = new Uint8Array(ciphertext.length);
  let prev = iv;
  for (let i = 0; i < ciphertext.length; i += BLOCK) {
    const block = ciphertext.subarray(i, i + BLOCK);
    const dec = decryptBlock(block, w);
    const xored = xorBlocks(dec, prev);
    out.set(xored, i);
    prev = block;
  }
  return pkcs7Unpad(out);
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
