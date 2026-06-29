import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSecureGet = vi.fn();
const mockSecureSet = vi.fn();
const mockRandomBytes = vi.fn();

vi.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
}));

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: (...args: unknown[]) => mockRandomBytes(...args),
}));

import {
  generateDbEncryptionKeyHex,
  getOrCreateDbEncryptionKey,
  resetDbEncryptionKeyCacheForTests,
} from '../encryption-key';

beforeEach(() => {
  mockSecureGet.mockReset();
  mockSecureSet.mockReset();
  mockRandomBytes.mockReset();
  resetDbEncryptionKeyCacheForTests();
});

function mockBytes(length: number, fill: number) {
  return new Uint8Array(length).fill(fill);
}

describe('generateDbEncryptionKeyHex', () => {
  it('returns a 64-character lowercase hex string (256-bit key)', async () => {
    mockRandomBytes.mockResolvedValueOnce(mockBytes(32, 0xab));
    const hex = await generateDbEncryptionKeyHex();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe('ab'.repeat(32));
  });

  it('handles 0x00 bytes correctly', async () => {
    mockRandomBytes.mockResolvedValueOnce(mockBytes(32, 0x00));
    const hex = await generateDbEncryptionKeyHex();
    expect(hex).toBe('00'.repeat(32));
  });
});

describe('getOrCreateDbEncryptionKey', () => {
  it('creates and stores a fresh key on first launch', async () => {
    mockSecureGet.mockResolvedValueOnce(null);
    mockRandomBytes.mockResolvedValueOnce(mockBytes(32, 0xcd));
    const key = await getOrCreateDbEncryptionKey();
    expect(key).toBe('cd'.repeat(32));
    expect(mockSecureSet).toHaveBeenCalledWith(
      'elogbook.db.encryption_key.v1',
      'cd'.repeat(32),
    );
  });

  it('returns the existing key on subsequent calls (no new random)', async () => {
    mockSecureGet.mockResolvedValueOnce('ab'.repeat(32));
    const key = await getOrCreateDbEncryptionKey();
    expect(key).toBe('ab'.repeat(32));
    expect(mockRandomBytes).not.toHaveBeenCalled();
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it('caches the key in module memory so we never re-read the keychain', async () => {
    mockSecureGet.mockResolvedValueOnce('ee'.repeat(32));
    const first = await getOrCreateDbEncryptionKey();
    const second = await getOrCreateDbEncryptionKey();
    expect(first).toBe(second);
    expect(mockSecureGet).toHaveBeenCalledTimes(1);
  });

  it('regenerates when the stored value is the wrong length (corruption guard)', async () => {
    mockSecureGet.mockResolvedValueOnce('tooshort');
    mockRandomBytes.mockResolvedValueOnce(mockBytes(32, 0xff));
    const key = await getOrCreateDbEncryptionKey();
    expect(key).toBe('ff'.repeat(32));
    expect(mockSecureSet).toHaveBeenCalled();
  });
});
