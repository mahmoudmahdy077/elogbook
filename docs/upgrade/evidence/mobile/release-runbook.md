# M7 — mobile release runbook (staged rollout)

**Status:** process wired; thresholds require baseline measurement + release-owner sign-off before any production track.

## Artifact inspection (every release candidate, from the downloaded AAB/IPA)

- [ ] bundle/application ID (`com.elogbook.app`), versionCode/versionName vs `app.json`
- [ ] signing certificate fingerprint matches the release keystore (record it here)
- [ ] permissions = camera, photo-library, biometric only (no broad storage/location)
- [ ] `allowBackup` rules + keystore/keychain backup behavior proven on restore
- [ ] cleartext policy (Android network security config) + iOS ATS: no exceptions
- [ ] release signing, R8/minification, source maps uploaded to Sentry, runtime version matches channel
- [ ] no embedded secrets/URLs (scan strings for `apikey`, `secret`, `http://`)
- [ ] exported components / deep-link filters limited to `elogbook://` + `https://elogbook.app`
- [ ] upgrade install from each of the two prior versions: data migrates, legacy keys drain once

## Rollout

1. **Internal alpha** (preview channel): team devices, matrix in `perf-budgets.md`.
2. **Beta** (internal track): 7-day soak, crash-free sessions target TBD from baseline.
3. **Staged production**: 10% → 50% → 100% with 48h bake each. Promote only when:
   - crash-free sessions ≥ threshold (set after baseline, owner-approved)
   - queue policy-quarantine rate < threshold
   - capability-denied rate stable (no auth outage)
4. **Kill switch**: halt staged rollout in store console + freeze EAS channel promotion; incident contacts: release owner, platform owner, clinical owner.
5. **Rollback**: promote the previous release candidate build (never a fresh build) to 100%; verify `client_operation_id` dedupe absorbs retried ops.

## Provenance (CI-uploaded per run)

source commit · `pnpm-lock.yaml` hash · `app.json`/`eas.json` hash · `licenses.json` ·
`pnpm audit` gate · per-platform build JSONs from the exact invocation
(`android-build.json`, `ios-build.json`) · `build-ids.env` · downloaded
candidate artifacts + `artifact-hashes.txt`.

N8 binding: `scripts/verify-eas-provenance.mjs` asserts each build record is
FINISHED, carries the candidate commit hash and app version, and exposes a
signed-artifact URL, which CI downloads and hashes. A generic "latest
finished build" listing is not accepted. Credential builds never run on
forks (`fork-validation` job covers static gates there).
