# T19 Evidence — Dual-mode policy core (bounded substep T19a)

Ticket: T19 (dependencies: T05, T08, T18). UI selector, egress audit,
offline reconciliation, historical-record workflow, retention, and G8
enablement are T19b+ work with the data-governance owner.
Status: POLICY CORE IMPLEMENTED (DB enforcement + truth table)

## Delivered

- Migration `20260907000004_data_mode_policy.sql`: `installation_policy`
  singleton (phi_ready + allow_identifiable, default false), tenant
  `data_mode_requested`/`allow_identifiable`/`data_policy_version`
  (de-identified defaults), `tenant_identifiable_allowed()` (all-four
  conjunction, fail-closed on unknown/missing), `enforce_data_mode()`
  trigger on case_entries (INSERT + UPDATE paths, history-preserving).
- pgTAP `p2_13_data_mode_policy.sql`: 10-assertion truth table —
  default deny, de-identified pass, full-enable pass, each single
  missing permission denies, switch-off history rules (non-identifier
  edits pass, identifier edits fail, no relabeling), unknown tenant
  denies. Wired into blocking CI db-tests.
- Verified non-interference: p1_3 uses `is_deidentified=true` rows only,
  untouched by the new trigger (checked by reading, not assumed).

## Verification

- Live pgTAP BLOCKED locally (no Docker); CI db-tests is the gate.
- Fixture hygiene enforced along the way: every pgTAP file owns its
  fixtures (rolled-back txns share nothing); FK/NOT NULL traps fixed in
  p2_11/p2_12 (separate commit).

## Deferred to T19b+ (governance owner)

Tenant mode selector UI + ceilings display, attachment/AI/export/
webhook/notification egress controls, offline-queue rejection, stale-
client revocation races, retention/conversion jobs, G8 assessment.
