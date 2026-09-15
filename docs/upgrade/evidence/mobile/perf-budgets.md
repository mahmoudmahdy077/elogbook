# M6 — performance budgets + accessibility (mobile)

**Date:** 2026-09-09 — budgets set BEFORE optimization (plan G-M7). No perf claim is qualified without a measured trace on a reference device.

## Budgets (low/mid/high refs TBD — measure before locking)

| Metric | Budget | Measured | Device | Trace |
|---|---|---|---|---|
| Cold start | ≤ 3.5s | TBD | low-end Android | — |
| Warm start | ≤ 1.2s | TBD | mid Android / iPhone | — |
| Time-to-interactive (case list) | ≤ 2.0s | TBD | mid | — |
| First case list query (local Watermelon) | ≤ 400ms p95, bounded query ≤100 rows | TBD | low | — |
| Large-form typing (no jank) | ≤ 16ms/frame, no full-list re-render | TBD | low | — |
| Sync bytes per cycle (delta only) | ≤ 500KB, paged 500/pull 100/push | TBD | metered | telemetry `queueDepth/latencyMs` |
| Memory (foreground) | ≤ 250MB PSS | TBD | low | — |
| Battery (background sync) | ≤ 1%/h, 60s periodic, backoff 10s→5m | TBD | — | — |

Rules: fix one measured bottleneck per change; virtualized lists, bounded queries, deferred noncritical work, image/file limits only where traces show need. No broad memoization/speculative caching.

## Accessibility target

- Labels on all inputs/buttons, Dynamic Type, VoiceOver/TalkBack pass, contrast ≥4.5:1, RTL layout, keyboard/switch where applicable.
- Automation: `pnpm --filter @elogbook/mobile exec vitest run lib/__tests__/a11y-labels.test.ts` (static label audit) + manual TalkBack/VoiceOver notes + screenshots/video stored per release.
- Clinical copy: one primary action/screen, clear offline/policy status, no implementation jargon.
