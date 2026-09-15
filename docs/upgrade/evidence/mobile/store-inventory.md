# R3 — local store inventory (producer inventory + bounds + disposal)

**Date:** 2026-09-09 · Probed by `lib/__tests__/phi-leakage.test.ts`
(synthetic MRN/DOB fixtures swept across every scoped store).

| Key (suffix after `user:tenant:` scope) | Content | Bound | Disposal |
|---|---|---|---|
| `case_form_draft.v1` | AEAD draft envelope | 1 item, overwritten | wiped on sign-out/switch |
| `durable_queue.v1` | AEAD op envelopes | 200 ops / 5 MB, refuse-new | quarantined under old scope |
| `audit_trail_buffer_v1` | hashed audit entries (no plaintext PHI) | 500 ring | worker stopped, memory dropped, copy quarantined |
| `telemetry_events_v1` | scrubbed analytics events | 200 ring | wiped on sign-out/switch |
| `sync_metrics_v1` | numeric counters only | rewritten | left (no identity) |
| `theme_mode` | light/dark/system | 1 value | left (device UI pref, no identity) |
| `biometric_auth_enabled`, `biometric_skip_window` (SecureStore) | booleans/seconds | 2 values | left (device pref, no identity) |
| `@elogbook/ratelimit:*` | token-bucket counters | per-action buckets | left (abuse counters, no identity) |
| `last_notification_check` | timestamp | 1 value | left (no identity) |
| `last_sync_timestamp` (dormant `db/storage.ts`) | timestamp | 1 value | module dormant, removal pending |
| `sync_checkpoint_v1`, `write_ahead_log_v1` (dormant `crash-recovery.ts`) | MUST stay empty of PHI | 100 ring | module dormant, removal pending |
| `offline_case_queue_v2` (legacy) | AEAD v2 envelopes | drained once, then deleted | migration preserves op IDs |
| `case_form_draft` (legacy plaintext) | deleted outright | — | `migrateLegacyDraftOnce` |
| `audit_trail_buffer_v1.quarantine` | foreign-actor audit rows | 500 ring | operator review |
| `*.corrupt.<ts>` | raw bytes of unparseable stores | diagnostic | operator review |

Unscoped keys hold no identity, PHI, tokens, or URLs by construction
(enforced by the leakage sweep for scoped producers; unscoped producers
carry timestamps/counters/prefs only). Dormant modules are marked
DORMANT and excluded from new code; deletion awaits the one-release
upgrade-evidence window per small-model rules.
