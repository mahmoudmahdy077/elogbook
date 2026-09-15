# ADR-001: Local-first mobile with cloud sync (M0)

**Date:** 2026-09-09
**Status:** Accepted (user decision: "local first then sync once online to cloud")
**Context:** Plan M0-2 offered (a) direct-online + encrypted retry queue vs (b) full Watermelon sync. User chose local-first. Review shows three overlapping paths: direct Supabase writes from screens, light encrypted queue (`offline-queue.ts`), dormant Watermelon `SyncEngine` (`sync/engine.ts` + `remote.ts` + `repository.ts` + `data-access.ts`).

## Decision

- Supported path = **local-first**: screens read/write WatermelonDB via `lib/data-access.ts` (AEAD-sealed PHI), `SyncEngine` pushes/pulls via `SupabaseSyncRemote` when online. Local write succeeds offline; cloud sync is eventual.
- Direct-online screen writes and standalone `offline-queue.ts` v2 become legacy: kept behind `LOCAL_FIRST_SYNC` flag for one release for migration, then deleted. No new features on legacy paths.
- Key model (interim, honest): per-install key in SecureStore (`elogbook.db.encryption_key.v1`) + AEAD field envelopes. NOT claimed as SQLCipher at rest until artifact proves native SQLCipher. Rotation/invalidation/reinstall/wipe contract in M2.
- Offline identifiable records allowed only under tenant-admin mode choice capped by platform/install policy, server-enforced (M1/M4). Client never enforces revocation; revoked/disallowed items quarantine with user-visible state, no silent retry.

## Consequences

- Must wire engine into root layout/screens, prove idempotency (client op ID → server id), per-account namespace, crash-between-response-and-delete, duplicate delivery, clock ties, tombstones, revocation, account switch (M3/M5 tests).
- Must add capability snapshot + account-context + wipe on switch/sign-out (M1) before expanding offline features.
- Must not claim SQLCipher, E2E encryption, offline sync, or production readiness without artifacts (ledger G-M0–G-M9).
- Open (record as fail, don't widen scope): Android min version pin, SQLCipher vs envelope final call after artifact inspection, key recovery policy (unrecoverable device key = data loss; document, don't promise recovery), attachment resumability limits.

## Alternatives rejected

- (a) Direct-online + small queue: simpler, but violates user's offline-resident requirement; retained only as fallback flag.
- Full custom sync protocol from scratch: rejected; reuse `SyncEngine` cursor/version + tombstone + LWW contract, harden with server time/version (not timestamp-only).
