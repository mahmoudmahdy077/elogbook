/**
 * M2 — encrypted, versioned, context-scoped case draft (local-first).
 *
 * Replaces plaintext `case_form_draft`. The draft is sealed with the
 * device AEAD key and stored under scopedKey('case_form_draft.v1'), so an
 * account switch or sign-out makes the old draft unqueryable. The envelope
 * binds userId/tenantId/schemaVersion inside the ciphertext; on load any
 * scope mismatch or decrypt failure returns null (never plaintext fallback).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptText, decryptText } from './crypto/aead';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { getAccountContext, scopedKey } from './account-context';

export const DRAFT_SCHEMA_VERSION = 1;
const DRAFT_KEY = 'case_form_draft.v1';

export interface CaseDraft {
  selectedTemplateId?: string;
  patientMrn?: string;
  patientDob?: string;
  patientAge?: string;
  caseDate?: string;
  fieldValues?: Record<string, string>;
  isDeidentified?: boolean;
  step?: number;
  schemaVersion?: number;
}

interface DraftEnvelope {
  v: number;
  userId: string | null;
  tenantId: string | null;
  savedAt: number;
  draft: CaseDraft;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** M1 boot barrier: drafts require a resolved account scope — never write `global:` keys. */
export async function saveDraft(draft: CaseDraft): Promise<void> {
  const ctx = getAccountContext();
  if (!ctx) throw new Error('[draft-store] no account context (refuse global draft write)');
  const keyHex = await getOrCreateDbEncryptionKey();
  const envelope: DraftEnvelope = {
    v: DRAFT_SCHEMA_VERSION,
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    savedAt: Date.now(),
    draft: { ...draft, schemaVersion: DRAFT_SCHEMA_VERSION },
  };
  const sealed = encryptText(hexToBytes(keyHex), JSON.stringify(envelope));
  await AsyncStorage.setItem(scopedKey(DRAFT_KEY), sealed);
}

/** Returns the draft or null (missing, corrupt, wrong key, or other scope). Never throws for storage/crypto errors. */
export async function loadDraft(): Promise<CaseDraft | null> {
  try {
    const ctx = getAccountContext();
    if (!ctx) return null;
    const raw = await AsyncStorage.getItem(scopedKey(DRAFT_KEY));
    if (!raw) return null;
    const keyHex = await getOrCreateDbEncryptionKey();
    const plaintext = decryptText(hexToBytes(keyHex), raw);
    const envelope = JSON.parse(plaintext) as DraftEnvelope;
    if (envelope.v !== DRAFT_SCHEMA_VERSION) return null;
    // Scope binding: envelope must match the active account.
    if ((envelope.userId ?? null) !== ctx.userId) return null;
    if ((envelope.tenantId ?? null) !== ctx.tenantId) return null;
    return envelope.draft;
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(scopedKey(DRAFT_KEY));
  } catch {
    // best-effort
  }
}

/** Legacy plaintext key — used only for one-time migration/deletion. */
export const LEGACY_DRAFT_KEY = 'case_form_draft';

/** Remove any legacy plaintext draft left by pre-M2 builds. */
export async function clearLegacyPlaintextDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // best-effort
  }
}
