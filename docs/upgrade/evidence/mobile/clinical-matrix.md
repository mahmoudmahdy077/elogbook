# M4 — clinical journey evidence (device runs required)

**Status:** matrix wired (`apps/mobile/lib/clinical-matrix.ts` + test); device
runs are the missing artifact (ledger `P1-clinical-matrix`).

## Journey checklist (each: resident + supervisor × identifiable + de-identified)

| # | Journey | States exercised | Evidence |
|---|---|---|---|
| 1 | Capture case, submit online | loading, empty templates, submit, approval-pending | device video + server row |
| 2 | Capture case offline, retry on reconnect | offline banner, saved-on-device copy, retry, sent | airplane-mode run + op ID |
| 3 | Edit submitted case | re-submit for approval, destructive-confirm | server status trail |
| 4 | Duplicate + repeat-last-entry | prefilled draft, submit | server rows |
| 5 | Supervisor approve / reject with comment | approve gate, destructive-confirm, server RPC | server status trail |
| 6 | Evaluation create (resident + supervisor picker) | capability gate, denied copy when suspended | denial screenshot |
| 7 | Duty hours log (+ invalid input) | validation error, saved copy | server row |
| 8 | Expired session mid-flow | expired-session state, re-login, no data loss | session log |
| 9 | Suspended tenant | suspended-tenant state everywhere, all actions denied | denial screenshots |
| 10 | Policy change identifiable→de-identified | policy-change notice, export denied | mode audit row |
| 11 | AI insights quota + disclosure | quota copy, disclosure notice | quota record |
| 12 | Attachment upload deny (exe/oversize) + allow (jpg) | validation copy, redacted logs | storage object |
| 13 | Push notification tap → deep link | foreground/background/killed | navigation trace |
| 14 | Sign-out + account switch | disposal proof (no old drafts/rows/notifications) | scoped-storage dump |

Unsupported surfaces (tenant-admin console, platform-admin console, bulk
export) must be probed from the app session and return server denial.
