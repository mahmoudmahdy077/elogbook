# R0.4 — release owner roster

**Date:** 2026-09-09 · All sign-offs below are REQUIRED for GO. `pending`
means the named human decision/evidence has not been recorded. Code
completion by the implementing model is never a sign-off.

| Area | Owner role | Status | Evidence required |
|---|---|---|---|
| Product mode (online-first-with-retry vs full-offline identifiable) | product/clinical | pending | signed decision record |
| Platform-admin boundary (tenant vs super-admin) | platform | pending | signed boundary + live-schema proof |
| Key/device-loss residual risk | security | pending | artifact inspection + written acceptance |
| Clinical acceptance (workflow order, wording, mode explanations, recovery copy) | clinical | pending | journey sign-off (R5 matrix) |
| Privacy/legal (identifiable retention, export, backup, regulatory mapping) | privacy/legal | pending | mapping sign-off |
| Accessibility (contrast, TalkBack/VoiceOver, Dynamic Type, RTL) | accessibility | pending | device reports + screenshots |
| Performance budgets + rollout thresholds | release | pending | measured traces, thresholds |
| Staged rollout / rollback / incident response authority | release | blocked until above | runbook + contacts |
| Setup/VPS rehearsal + backup/restore + update approval | platform | pending | disposable-VPS artifacts |

No release, store submission, or customer install proceeds while any row
is pending. The implementing model must stop and ask rather than assume.
