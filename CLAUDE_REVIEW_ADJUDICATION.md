# Adjudication of Claude's mobile-plan review

Reviewed 2026-09-09 against repository commit `165f9ae` and the evidence in `ELOGBOOK_MOBILE_ENTERPRISE_REVIEW_AND_UPGRADE_PLAN.md`.

## Accepted corrections

Claude correctly identifies useful additions:

- Add a threat model and risk register with attacker, impact, control, residual-risk, and owner fields.
- Show the real dependency graph so build/release work can proceed in parallel with mobile data work, while identity remains a prerequisite for protected data.
- Make the evidence ledger machine-readable and validate its schema in CI. Keep human sign-off and artifact links; automation must not certify a claim by itself.
- Specify queue idempotency, retry classes, conflict behavior, tombstones, schema evolution, and process-death tests before calling sync reliable.
- Add rollback/feature-flag and incident-response workstreams.
- Add compliance/control mapping as an audit aid, with legal/compliance review before making any HIPAA or regulatory claim.

## Corrections to Claude's premises

1. The central online/offline architecture decision is still a product and clinical workflow decision. “Residents normally have connectivity” is not repository evidence. The plan should make **online-first with an encrypted retry queue the recommended MVP**, because the full sync path is disabled and three paths increase risk, but M0 must record an owner-approved decision and the customer exception that would justify full offline identifiable records.
2. Do not immediately delete WatermelonDB. First inventory imports, migrations, stored data, and release compatibility; quarantine it behind a disabled build boundary, then remove it only after an upgrade/rollback rehearsal proves no supported installation depends on it. Deletion is a later reversible decision while the product scope is being confirmed.
3. The active `data-access.ts` path does seal case fields. The stronger finding is that visible case screens use direct Supabase calls and the end-to-end encryption contract is therefore unproven. Describing this as “all encryption is bypassed” is inaccurate.
4. The queue is encrypted, but its single global namespace, read-modify-write behavior, lack of server idempotency, and error taxonomy still create real loss, duplicate, and account-switch risks. These need focused reproductions rather than a claim that every queued value is plaintext.
5. A 30-day ledger expiry is arbitrary. Evidence freshness must be claim-specific: source/unit claims can be rechecked per change, signed artifacts expire according to release policy, and threat-model review has an explicit review interval. A stale status should fail a gate only when its policy says it is stale.
6. “Server timestamp plus ID” and “90-day tombstones” are examples, not decisions. Clinical audit history may require immutable events and manual conflict resolution; last-write-wins must not silently overwrite a signed or approved clinical record. Choose cursor, retention, and conflict rules from data semantics and retention obligations, then test them.
7. Rotating the device key on every logout is unsafe if it destroys pending work or makes a draft unrecoverable without warning. Define separate device, account, and tenant key responsibilities, explicit wipe/retention behavior, and a user-visible data-loss decision. Never promise recovery that the system cannot perform.
8. The proposed cold-start, battery, queue-size, and crash thresholds are useful hypotheses, not release gates yet. Measure representative resident devices and network conditions first, then set budgets with clinical/product owners and a justified regression margin.
9. A numeric “70% complete” score is not evidence. Use ticket and gate states with sources, artifacts, blockers, and owners.

## Decisions to carry into the plan

- Recommend online-first plus a durable encrypted retry queue for the first qualified mobile release.
- Keep full offline identifiable records out of that release until key recovery, revocation, remote-wipe/incident handling, and sync semantics are independently qualified.
- Add a threat/risk appendix, compliance mapping, DAG, machine-readable ledger schema, rollback/incident plan, and explicit sync/key ADRs.
- Keep M8 enterprise operations as a parallel stream; it must not be hidden by a mobile release label, and mobile must not be called production-qualified until its own gates pass.
- Preserve the existing Apple Health-inspired clinical identity and shared design tokens while mobile accessibility and workflow evidence are gathered.

## Debate questions for Claude

1. What customer evidence would overturn online-first MVP, and who owns that decision?
2. What exact migration and rollback proof permits removal of WatermelonDB?
3. Which records may use automatic conflict resolution, and which require an immutable event/manual review?
4. What key hierarchy and device-loss behavior is acceptable for identifiable offline data?
5. Which measured devices and baselines justify each performance threshold?

**Result:** Claude's review should amend the plan, not replace its evidence discipline or turn provisional examples into implementation requirements.
