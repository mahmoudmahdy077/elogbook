# Wave 3 Report

Date: 2026-08-25 · Baseline: post-repair (8fb4f66) · Mode: coordinator-driven

## Track A — Full regression rotation
32/32 suites green, zero failures, ~185 checks. Every Wave-1/2 fix holds.

## Track B — MFA escalation probe (isolated account)
- Self-promotion resident→director WITHOUT MFA: BLOCKED (400) ✓
- Platform GoTrue MFA endpoints: available via app client (raw REST path I used earlier was misrouted)
- Enrollment page renders live TOTP challenge; completable by design
- Conclusion: security F2 CLOSED — gate is sound. Director+/UI logins require one-time TOTP enrollment (P6.1 by design); API-only flows unaffected.
- Note: demo director account intentionally left un-enrolled to keep automation working.
- Implemented: DISABLE_MFA env flag now functional in getAuthContext (escape hatch for deployments running auth servers without MFA).

## Track C — Storage / attachments depth
- Bucket `case-attachments` private ✓; anon listing denied ✓
- case_attachments metadata RLS correct: resident inserts own, reads own; supervisor reads tenant ✓
- Object upload denied by storage RLS AND no application code uploads objects anywhere (web/mobile) → attachments is an UNWIRED SCAFFOLD (table+bucket only). Logged as P4 roadmap item, not a bug.

## Track D — Cross-role prod browser sweep (elogbook-web.vercel.app)
| Role | Surfaces | Result |
|---|---|---|
| supervisor | dashboard + Approvals queue | ✓ nav visible w/ pending badge; "Pending Approvals" renders |
| supervisor | /compliance | ✗→ redirected (server-side RBAC blocks supervisor) ✓ |
| director | /mfa/enroll | ✓ live TOTP challenge (gate working; enrollment left incomplete deliberately) |

## Track E — Authenticated edge-function contracts
| Function | Result |
|---|---|
| generate-pdf {case_ids,resident_name,tenant} | 200 `%PDF-` 1514 bytes in 975ms ✓ |
| ai-quality (resident) | 403 supervisor+ required — by design |
| create-checkout (resident) | 403 director+ required — billing RBAC ✓ |

All functions fast-fail <1s under authenticated calls; no hangs.

SWARM-DONE wave3
