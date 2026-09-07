# T13 Evidence — Release states (bounded substep)

Ticket: T13 (dependencies: T06, T10–T11). Signed manifests, Sigstore/
cosign trust policy, rotation, revocation plumbing, and registry identity
are T13-full (needs release setup + owner decisions).
Status: IMPLEMENTED (state model + tracker repair; signing deferred)

## Defects fixed (F06)

1. `{owner}` placeholder in the elogbook release URL could never have
   worked → explicit `ELOGBOOK_RELEASE_REPO=owner/repo`; absent/invalid
   config yields `check-failed`, never silence.
2. Null conflation: fetch failure, missing versions file, and "no update"
   all surfaced as null, which the page rendered as "Your system is up
   to date." Now six distinct states end to end (tracker → route
   pass-through → page copy); only `update-available` is actionable.
3. Same-tag self-update offered (checkbox to "update" vX → vX) → now
   `up-to-date`, no checkbox.
4. Supabase monorepo `latest` posed as a qualified update → now
   `unsupported-source` pointing at the qualified-bundle flow (T15).

## Added

- `apps/ops/src/release-state.ts`: forward state resolver over (installed
  version, catalog view) — up_to_date/update_available (+target)/
  unsupported_transition/check_failed/offline/unknown_current_version;
  revoked releases never offered. 7/7 suite (2 fixture corrections from
  failing assertions, implementation held).
- `apps/web/lib/setup/version-tracker.ts`: discriminated
  `UpdateCheckResult`, path-injectable versions file, env-configured
  repo, offline-vs-failed distinction. 6/6 suite (temp files + fetch
  stub; old code provably returned null/self-update for these cases).
- `apps/web/app/update/page.tsx`: per-component status lines; checkbox
  only for update-available.

## Verification

- ops 47/47 (40 prior + 7 new), version-tracker 6/6, web typecheck 0,
  lint 0.

## Deferred to T13-full

Manifest schema/signing/rotation/revocation/expiry, issuer pinning,
offline/rate-limit provider handling against the real catalog, two-line
(Supabase bundle) compatibility matrix — needs release setup + registry.
