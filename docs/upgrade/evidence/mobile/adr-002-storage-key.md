# ADR-002: qualified-release data path, storage claim, and key contract (M0–M2)

**Date:** 2026-09-09 · **Status:** accepted-provisional (human sign-offs recorded as ledger blockers).

## 1. Qualified release path

The first qualified mobile release is **online-capable case capture with one
durable encrypted retry queue** (`apps/mobile/lib/durable-queue.ts`):

- Screens build a validated payload, attempt the server write, and on
  transient-network failure persist the encrypted operation locally with a
  stable `client_operation_id`, then report **queued-locally** — never
  "submitted" before server confirmation.
- Edits use the same queue (`update` ops). Nothing is silently online-only.
- The queue flushes through an idempotent server upsert contract keyed on
  `client_operation_id` (migration `20260909000000`), so duplicate delivery
  and crash-between-response-and-delete converge to one row.

This satisfies both the plan's provisional online-first recommendation and
the standing product direction (local write first, sync when online): the
mechanism is identical; only the *promise* differs. **Full-offline
identifiable records** (capture with no connectivity expectation, conflict
resolution, retention, revocation of held records) remain a **separate,
unpromised qualification cycle** until revocation, device-loss, key-recovery,
conflict, and retention requirements are accepted by the clinical/security
owner (ledger `HUMAN-product-mode`).

Unsupported offline promises (must never appear in product copy): background
sync guarantees under OS limits, conflict auto-merge for clinical fields,
revocation of already-held identifiable records from the client alone,
recovery of data sealed with a lost device key.

## 2. Precise storage claim

- **Claimed:** case drafts (`draft-store.ts`) and queued operations
  (`durable-queue.ts`) and PHI fields written via `data-access.ts`
  (`sealPhi`/`openPhi`) are AEAD envelopes (AES-256-CBC + HMAC-SHA-256,
  Encrypt-then-MAC) keyed by a per-install device key in SecureStore.
  Tamper, wrong key, or wrong account scope fails closed to null/quarantine —
  never plaintext fallback.
- **NOT claimed:** SQLCipher / whole-database encryption at rest. The
  Watermelon adapter is a normal `SQLiteAdapter` with no native key option
  wired; non-PHI columns and metadata are plaintext SQLite. Server-bound
  payloads are plaintext by design (TLS transport + server controls).
- Any future at-rest database claim requires a signed-artifact inspection
  (ledger `P1-sqlcipher-boundary`).

## 3. Key hierarchy and lifecycle

- **Device master key** `elogbook.db.encryption_key.v1` (32 bytes, SecureStore,
  per-install). Shared across accounts on the device — envelopes additionally
  bind `userId`/`tenantId`/schema inside the ciphertext and storage keys are
  `scopedKey()`-namespaced, so a wrong scope fails closed.
- **Rotation trigger:** suspected compromise, explicit user action, or
  reinstall. `rotateDbEncryptionKey()` replaces the key; envelopes sealed
  with the prior generation become unreadable by design (re-seal open work
  first; document data loss, never promise recovery).
- **Invalidation:** `invalidateDbEncryptionKey()` deletes the platform item
  and clears the process cache (logout, device transfer, reinstall).
- **Loss:** unrecoverable-device data loss is accepted behavior, not a bug;
  requires security-owner approval (ledger `P1-key-hierarchy`).
- **Backup behavior:** SecureStore items may or may not survive OS backup
  depending on platform flags — must be proven per artifact; until proven,
  assume a restored backup without the key yields unreadable envelopes
  (fail-closed), and a restored backup with the key yields old-scope data
  that scope checks still reject after account change.

## 4. Supported matrix (provisional, release owner to confirm)

Expo ~56 · RN 0.85.3 · Node 22.14.0 · pnpm 9.15.0 · EAS CLI 14.0.0 ·
Android `com.elogbook.app` (versionCode 30) · iOS `com.elogbook.app` ·
deployment target iOS 16.4 · locales `en` + `ar` (RTL in progress) ·
accessibility target WCAG 2.1 AA. Rollback authority: release owner (kill
switch + staged rollout + prior-version compat tests).
