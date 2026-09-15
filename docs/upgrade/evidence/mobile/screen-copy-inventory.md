# N7.4 — screen copy inventory (explicit exceptions)

**Rule:** new/changed product copy lives in `apps/mobile/lib/copy.ts`
(English source + `ar` translations, English fallback, `missingKeys()`
report). Screens below remain hardcoded English — each is an EXPLICIT
exception pending the full translation pass (ledger-blocked device artifact:
Arabic/RTL review with native speakers). No screen may claim full
localization until that pass lands.

| Screen | Copy state | Notes |
|---|---|---|
| login | hardcoded EN (exception) | auth errors from server stay server-text |
| index (dashboard) | hardcoded EN (exception) | counts via `formatCount` (locale-aware) |
| log-case | hardcoded EN (exception) | submit outcomes via keyed copy: `queueStatusCopy` |
| my-cases / case-detail | hardcoded EN (exception) | approval outcomes via fixed adapter copy |
| approvals | hardcoded EN (exception) | adapter outcomes use fixed copy keys |
| evaluations | hardcoded EN (exception) | adapter outcomes use fixed copy keys |
| duty-hours | hardcoded EN (exception) | adapter outcomes use fixed copy keys |
| rotations / milestones | hardcoded EN (exception) | list errors via logger (no PHI) |
| analytics / ai-insights | hardcoded EN (exception) | quota/disclosure copy pending clinical wording |
| profile | hardcoded EN (exception) | Appearance labels pending translation |
| offline/status banners | KEYED (`copy.ts`, en+ar) | `offlineStatusCopy`, `queueStatusCopy` |
| auth/session failures | KEYED (`copy.ts`, en+ar) | `session.expired`, `denied.*`, `queue.full`, `mode.mismatch` |

Server error strings never render directly: adapters map outcomes to fixed
copy; raw text goes to the redacted logger only.
