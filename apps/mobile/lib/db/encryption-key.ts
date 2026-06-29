import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const DB_ENCRYPTION_KEY_NAME = 'elogbook.db.encryption_key.v1';
const KEY_BYTES = 32;

let cachedKey: string | null = null;

/**
 * Generates a 256-bit random key, hex-encoded (64 chars).
 * Uses expo-crypto's getRandomBytes which is a CSPRNG on-device.
 */
export async function generateDbEncryptionKeyHex(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(KEY_BYTES);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Returns the per-install database encryption key, creating one in the
 * platform keychain/keystore on first launch. Subsequent calls return the
 * cached value. The same key MUST be returned for the lifetime of the
 * install or the database will be unreadable after rotation.
 */
export async function getOrCreateDbEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const existing = await SecureStore.getItemAsync(DB_ENCRYPTION_KEY_NAME);
  if (existing && existing.length === KEY_BYTES * 2) {
    cachedKey = existing;
    return existing;
  }
  const fresh = await generateDbEncryptionKeyHex();
  await SecureStore.setItemAsync(DB_ENCRYPTION_KEY_NAME, fresh);
  cachedKey = fresh;
  return fresh;
}

export function resetDbEncryptionKeyCacheForTests(): void {
  cachedKey = null;
}
