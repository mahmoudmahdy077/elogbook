# N0.1 — iteration candidate snapshot (NOT a release)

**Date:** 2026-09-09 · **Base commit:** `165f9ae`
**Tree state:** DIRTY — 97 changed/untracked paths (mobile qualification work
from the previous two iterations, uncommitted). Uncommitted source is not a
release candidate and must not be called one.
**Lockfile:** `pnpm-lock.yaml` SHA256 `8C0F4D091EDA3B13ED31E0E0A4A45EE6BC7E194E43CE0660FC2239F5F5E4F96F`
**Toolchain:** node v22.23.1 · pnpm 9.15.0 · tsc 6.0.3 · Expo ~56 · EAS CLI pinned 14.0.0 (CI) · eas.json pinned 14.0.0
**Environment limits (this machine):** no Java/Android SDK (no signed-binary
inspection possible); no Docker daemon verified for disposable-DB/VPS
rehearsal here (must run in CI/disposable infra); no physical devices
(device matrix, traces, TalkBack/VoiceOver must run on real hardware).

## Regression baseline carried in

- Mobile vitest 53 files / 388 passed / 0 skipped; `check-mobile-ledger.mjs` OK.
- Web targeted suites (setup guard, platform + tenant publish) 18 passed.
- `tsc --noEmit` mobile + web clean; ESLint mobile + touched web files clean.
- Migration lint exit 0.

## What this iteration must still prove elsewhere

Fresh + upgrade Supabase replay with pgTAP (incl. new p3_03/p3_04),
disposable-host setup probe, EAS build-ID provenance run, device matrix,
owner sign-offs. See `ledger.yaml` blockers and the N-G0–N-G9 gate table.
