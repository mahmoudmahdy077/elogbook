/**
 * Light offline queue v2 — encrypted case payloads stored in AsyncStorage.
 *
 * Replaces crypto-js with the dependency-free AEAD module (AES-256-CBC +
 * HMAC-SHA-256 EtM). Flushed on reconnect / app foreground via SyncService.
 *
 * SECURITY: each payload is individually authenticated with HMAC before
 * decryption, so tampered/corrupted items are rejected.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptText, decryptText, CryptoError } from './crypto/aead';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { supabase } from './supabase';

export const OFFLINE_QUEUE_KEY = 'offline_case_queue_v2';

export interface QueuedCasePayload {
  id: string;
  iv: string;
  ciphertext: string;
  tag: string;
  createdAt: number;
}

export type QueueCaseData = Record<string, unknown>;

/**
 * Secure RFC4122 v4 UUID using CSPRNG.
 * Mirrors `apps/mobile/lib/crypto/aead.ts:defaultRandomBytes` — uses
 * `globalThis.crypto.getRandomValues` (available in Hermes, Node >=19, browsers).
 * Throws instead of falling back to Math.random (see Karpathy secure defaults).
 */
function uuidv4(): string {
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
    throw new Error(
      '[offline-queue] No CSPRNG available (globalThis.crypto.getRandomValues). ' +
        'Cannot generate secure UUID. Ensure platform provides a CSPRNG.',
    );
  }
  g.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readQueue(): Promise<QueuedCasePayload[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCasePayload[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedCasePayload[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

/**
 * Enqueue a case payload for later sync. The payload is encrypted with
 * AES-256-CBC + HMAC-SHA-256 before being written to AsyncStorage.
 */
export async function enqueueCase(caseData: QueueCaseData): Promise<void> {
  const key = await getOrCreateDbEncryptionKey();
  const keyBytes = hexToBytes(key);
  const envelope = encryptText(keyBytes, JSON.stringify(caseData));
  const items = await readQueue();
  items.push({ id: uuidv4(), iv: '', ciphertext: envelope, tag: '', createdAt: Date.now() });
  await writeQueue(items);
}

export async function getPendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export interface FlushResult {
  synced: number;
  failed: number;
  lastError: string | null;
}

/**
 * Flush the queue: decrypt each item and insert into Supabase.
 * Items that fail due to network errors are kept for later retry.
 * Items that fail due to tamper/corruption are dropped (MAC failed).
 */
export async function flushQueue(): Promise<FlushResult> {
  const items = await readQueue();
  if (items.length === 0) return { synced: 0, failed: 0, lastError: null };

  const key = await getOrCreateDbEncryptionKey();
  const keyBytes = hexToBytes(key);
  const remaining: QueuedCasePayload[] = [];
  let synced = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const item of items) {
    try {
      const plaintext = decryptText(keyBytes, item.ciphertext);
      const caseData = JSON.parse(plaintext) as QueueCaseData;
      const { error } = await supabase.from('case_entries').insert(caseData);
      if (error) {
        const isTransient = /network|fetch|timeout|abort|connect/i.test(error.message);
        if (isTransient) remaining.push(item);
        failed++;
        lastError = error.message;
      } else {
        synced++;
      }
    } catch (err) {
      if (err instanceof CryptoError) {
        // Tamper/corruption = permanently bad item → drop it
        failed++;
        lastError = 'corrupted queue item dropped';
      } else {
        // Other errors (parse, network) → keep for retry
        remaining.push(item);
        failed++;
        lastError = String(err);
      }
    }
  }

  await writeQueue(remaining);
  return { synced, failed, lastError };
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
