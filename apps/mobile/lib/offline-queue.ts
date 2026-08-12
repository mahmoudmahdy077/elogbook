// Light offline queue: encrypted case payloads stored in AsyncStorage.
// Each item is AES-256-CBC encrypted with the SecureStore-backed device key
// (lib/db/encryption-key.ts) and a fresh random IV. Flushed on reconnect /
// app foreground via SyncService.initSync.
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { supabase } from './supabase';

export const OFFLINE_QUEUE_KEY = 'offline_case_queue_v1';

export interface QueuedCasePayload {
  id: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

export type QueueCaseData = Record<string, unknown>;

function uuidv4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
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

export async function enqueueCase(caseData: QueueCaseData): Promise<void> {
  const key = await getOrCreateDbEncryptionKey();
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex = Array.from(ivBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(caseData), key, {
    iv: CryptoJS.enc.Hex.parse(ivHex),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();

  const items = await readQueue();
  items.push({ id: uuidv4(), iv: ivHex, ciphertext, createdAt: Date.now() });
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

export async function flushQueue(): Promise<FlushResult> {
  const items = await readQueue();
  if (items.length === 0) return { synced: 0, failed: 0, lastError: null };

  const key = await getOrCreateDbEncryptionKey();
  const remaining: QueuedCasePayload[] = [];
  let synced = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const item of items) {
    try {
      const plaintext = CryptoJS.AES.decrypt(item.ciphertext, key, {
        iv: CryptoJS.enc.Hex.parse(item.iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }).toString(CryptoJS.enc.Utf8);
      const caseData = JSON.parse(plaintext) as QueueCaseData;
      const { error } = await supabase.from('case_entries').insert(caseData);
      if (error) {
        // Network/transient errors: keep the item for a later retry.
        // RLS/validation errors are permanent for this payload: drop it.
        const isTransient = /network|fetch|timeout|abort|connect/i.test(error.message);
        if (isTransient) remaining.push(item);
        failed++;
        lastError = error.message;
      } else {
        synced++;
      }
    } catch {
      // Decrypt/parse failure = corrupted item; drop it so the queue drains.
      failed++;
      lastError = 'corrupted queue item dropped';
    }
  }

  await writeQueue(remaining);
  return { synced, failed, lastError };
}
