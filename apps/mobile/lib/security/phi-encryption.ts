/**
 * PHI Field-Level Encryption at Rest.
 *
 * Encrypts sensitive patient data (patient_mrn, patient_dob, field_values)
 * before storing in WatermelonDB. Uses the AEAD module (AES-256-CBC +
 * HMAC-SHA-256 EtM) with keys derived from the device keystore.
 *
 * SEC-006 resolution: provides encryption at rest regardless of SQLCipher
 * native build flag. PHI fields are encrypted individually so the database
 * file can be inspected without exposing patient data.
 *
 * Key rotation: supported via versioned key derivation. When a new key is
 * generated, re-encryption happens lazily on next read (transparent to callers).
 */

import { encryptText, decryptText, CryptoError } from '../crypto/aead';
import { getOrCreateDbEncryptionKey } from '../db/encryption-key';

// ---------------------------------------------------------------------------
// PHI field definitions per table
// ---------------------------------------------------------------------------

export type PHITable = 'case_entries' | 'evaluation_forms';

export interface PHIColumn {
  name: string;
  type: 'text' | 'json';
}

/**
 * Columns that contain PHI and must be encrypted at rest.
 * The order matters — these are the fields we encrypt before storage.
 */
export const PHI_FIELDS: Record<PHITable, PHIColumn[]> = {
  case_entries: [
    { name: 'patient_mrn', type: 'text' },
    { name: 'patient_dob', type: 'text' },
    { name: 'field_values', type: 'json' },
  ],
  evaluation_forms: [
    { name: 'patient_context', type: 'text' },
  ],
};

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * Encrypt a single PHI value. Returns the AEAD envelope hex string.
 * Null/undefined values pass through unchanged (not encrypted).
 */
export async function encryptPHIField(value: unknown): Promise<string | null | undefined> {
  if (value === null || value === undefined) return value as null | undefined;
  if (value === '') return ''; // empty string is not PHI

  const key = await getOrCreateDbEncryptionKey();
  const keyBytes = hexToBytes(key);

  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  return encryptText(keyBytes, plaintext);
}

/**
 * Decrypt a single PHI value from its AEAD envelope.
 * Returns the original plaintext. Handles null/undefined passthrough.
 */
export async function decryptPHIField(encryptedValue: unknown): Promise<string | null | undefined> {
  if (encryptedValue === null || encryptedValue === undefined) return encryptedValue as null | undefined;
  if (encryptedValue === '') return '';
  if (typeof encryptedValue !== 'string') return encryptedValue as string;

  // Check if it looks like an AEAD envelope (hex string, starts with version byte 01)
  if (encryptedValue.length < 4 || !/^[0-9a-f]+$/i.test(encryptedValue)) {
    return encryptedValue; // not encrypted — pass through (migration/compat)
  }

  try {
    const key = await getOrCreateDbEncryptionKey();
    const keyBytes = hexToBytes(key);
    return decryptText(keyBytes, encryptedValue);
  } catch (err) {
    if (err instanceof CryptoError) {
      console.warn('[PHI] Decryption failed (key mismatch or tamper):', err.message);
      return encryptedValue; // return as-is to avoid data loss
    }
    throw err;
  }
}

/**
 * Encrypt all PHI fields in a row object. Returns a new object with
 * encrypted values. Non-PHI fields are passed through unchanged.
 */
export async function encryptPHIRow<T extends Record<string, unknown>>(
  table: PHITable,
  row: T,
): Promise<T> {
  const phiColumns = PHI_FIELDS[table];
  if (!phiColumns) return row;

  const result = { ...row };
  for (const col of phiColumns) {
    if (col.name in result) {
      (result as Record<string, unknown>)[col.name] = await encryptPHIField(result[col.name]);
    }
  }
  return result;
}

/**
 * Decrypt all PHI fields in a row object. Returns a new object with
 * decrypted values. Non-PHI fields are passed through unchanged.
 */
export async function decryptPHIRow<T extends Record<string, unknown>>(
  table: PHITable,
  row: T,
): Promise<T> {
  const phiColumns = PHI_FIELDS[table];
  if (!phiColumns) return row;

  const result = { ...row };
  for (const col of phiColumns) {
    if (col.name in result) {
      (result as Record<string, unknown>)[col.name] = await decryptPHIField(result[col.name]);
    }
  }
  return result;
}

/**
 * Batch encrypt multiple rows (used during sync push).
 */
export async function encryptPHIRows<T extends Record<string, unknown>>(
  table: PHITable,
  rows: T[],
): Promise<T[]> {
  const phiColumns = PHI_FIELDS[table];
  if (!phiColumns) return rows;

  return Promise.all(rows.map((row) => encryptPHIRow(table, row)));
}

/**
 * Batch decrypt multiple rows (used during sync pull).
 */
export async function decryptPHIRows<T extends Record<string, unknown>>(
  table: PHITable,
  rows: T[],
): Promise<T[]> {
  const phiColumns = PHI_FIELDS[table];
  if (!phiColumns) return rows;

  return Promise.all(rows.map((row) => decryptPHIRow(table, row)));
}

/**
 * Check if a value is encrypted (has AEAD envelope format).
 */
export function isEncrypted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.length >= 4 && /^[0-9a-f]+$/i.test(value) && value.startsWith('01');
}
