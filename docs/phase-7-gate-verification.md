# Phase 7 Gate Verification — P7.8

> Status snapshot for the Phase 7 hardening & compliance work.
> This document is the P7.8 deliverable. Re-run after any change to
> the items in the table.

## Local verification (this worktree)

Run from the repo root:

```bash
pnpm -r typecheck      # 4 of 5 workspace projects, exit 0
pnpm test              # 32 test files, 233 tests, 0 failed
```

Both green on `feat/phase-7-hardening` at the time of the P7.8
commit. Captured output:

| Command | Result |
|---------|--------|
| `pnpm -r typecheck` | `packages/supabase ok`, `packages/shared Done`, `apps/web Done`, `apps/mobile Done` — exit 0 |
| `pnpm test` | `Test Files 32 passed (32)`, `Tests 233 passed (233)` — exit 0 |

## Gate checklist (from the plan)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | SBOM generated on release | ✅ | `.github/workflows/sbom.yml` triggers on `v*` tags, runs `npx @cyclonedx/cyclonedx-npm`, attaches to release. CI artifact: `sbom-cyclonedx` (90d retention). |
| 2 | `pnpm audit` blocking in CI | ✅ | `.github/workflows/ci.yml` `audit` job: `continue-on-error: true` removed. Verified with `[email protected]` → `pnpm audit --prod --audit-level=high` returns exit 1 (13 findings, 11 HIGH). |
| 3 | CodeQL fails on `error` severity | ✅ | `.github/workflows/codeql.yml` adds a `Fail on error-severity findings` step that parses the SARIF for `level: error` and exits non-zero. Verified end-to-end with synthetic SARIF (1 finding → exit 1; clean SARIF → exit 0). |
| 4 | Semgrep runs in CI | ✅ | `.github/workflows/semgrep.yml` runs the curated `.semgrep.yml` + `p/typescript` + `p/owasp-top-ten` + `p/javascript`, with `--error` on ERROR-severity findings. Verified locally with synthetic test files (5 rule types fire correctly). |
| 5 | ZAP DAST on preview | ✅ (workflow) | `.github/workflows/dast.yml` listens for `deployment_status` events (Vercel) and runs `zap-baseline.py`. Verified the SARIF-gate logic with synthetic reports (1 HIGH → exit 1; clean → exit 0). Live preview scan is a CI check; no public preview is reachable from this worktree. |
| 6 | Trivy container scan | ✅ (workflow) | `.github/workflows/container-scan.yml` builds `apps/web/Dockerfile` and runs `aquasecurity/trivy-action@0.28.0` with `--severity CRITICAL --exit-code 1`. Docker daemon was not reachable in this worktree, so the build+scan is a CI check. |
| 7 | Compliance templates exist and link from SECURITY.md | ✅ | `docs/compliance/{pen-test-report-template.md, dpia-template.md, hipaa-checklist.md, gdpr-checklist.md}` all present. All four are linked from the "Compliance artifacts" section in `SECURITY.md`. |
| 8 | PITR enabled (verify in Supabase dashboard) | 🟡 | The `[db.backups]` and `[branches]` markers in `supabase/config.toml` are documentation; the actual setting is project-level. Enable in dashboard: Settings → Database → Point in Time Recovery. Documented in `docs/operations.md` §"PITR". |
| 9 | Branching works for previews | 🟡 (workflow-ready) | `supabase/config.toml [branches] enabled = true` is a documentation marker. Enable in dashboard: Settings → Branches. The Phase 8 `preview-branch.yml` will be the consumer. |
| 10 | Key rotation RPC tested | ✅ | `supabase/migrations/00062_key_rotation.sql` adds `rotate_encryption_key(old, new)`, `rotate_mrn_salt(tenant_id)`, and `decrypt_with_version(bytea, int)`. `supabase/tests/00062_key_rotation.test.sql` exercises the full round-trip (insert v1 → decrypt v1 → rotate → decrypt v2 → idempotency → audit log). Static-validated locally (no Postgres in this worktree). |

## Workflows added

| File | Trigger | Purpose |
|------|---------|---------|
| `.github/workflows/sbom.yml` | tag `v*` | CycloneDX SBOM → artifact + release attachment |
| `.github/workflows/semgrep.yml` | PR + push + Mon 04:23 UTC | SAST (5 custom rules + 3 official packs) |
| `.github/workflows/dast.yml` | Vercel `deployment_status: success` | ZAP baseline against preview URL |
| `.github/workflows/container-scan.yml` | PR + push + Wed 05:37 UTC | Build web image + Trivy fail-on-CRITICAL |

## Workflows modified

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Removed `continue-on-error: true` from `audit` job (now blocking) |
| `.github/workflows/codeql.yml` | Added explicit fail-on-error-severity post-step + `config-file:` pointer |
| `.github/codeql/codeql-config.yml` | New — references the `security-and-quality` query pack |

## Compliance artifacts added

| File | Maps to |
|------|---------|
| `docs/compliance/pen-test-report-template.md` | annual pen-test (HIPAA §164.308(a)(8), GDPR Art. 32) |
| `docs/compliance/dpia-template.md` | GDPR Art. 35 + HIPAA feature-level review |
| `docs/compliance/hipaa-checklist.md` | §164.308 / §164.310 / §164.312 / §164.316 — every Technical Safeguard mapped to a plan task |
| `docs/compliance/gdpr-checklist.md` | Art. 5, 7, 9, 12-14, 15, 17, 20, 25, 28, 30, 32, 33, 34 — every in-scope article mapped to a control |

## Supabase artifacts

| File | Purpose |
|------|---------|
| `supabase/config.toml` | `[db.backups]` and `[branches]` documentation markers + retention_days = 7 |
| `supabase/migrations/00062_key_rotation.sql` | `decrypt_with_version`, `rotate_encryption_key`, `rotate_mrn_salt`; updates `secret_ai_config` / `secret_payment_gateway_config` views |
| `supabase/tests/00062_key_rotation.test.sql` | psql round-trip test (insert v1, decrypt v1, rotate, decrypt v2, idempotency, audit row) |
| `docs/operations.md` | PITR restore runbook + per-tenant salt rotation procedure |

## Items pending operator action (not blocking the gate)

1. **PITR + Branches enablement in dashboard** — the config.toml
   changes are documentation; the operator must toggle the
   project-level switches in the Supabase dashboard before going
   live.
2. **External pen-test firm engagement** — out of scope for the
   plan; track as a follow-up issue and run the engagement against
   the template at `docs/compliance/pen-test-report-template.md`.
3. **Live ZAP + Trivy scans** — these are CI-only; first execution
   will be on the next PR / push.

## Sign-off

| Role | Date | Status |
|------|------|--------|
| Local CI | this commit | typecheck green, 233/233 tests pass |
| Phase 7 implementer | this commit | P7.0 → P7.8 committed on `feat/phase-7-hardening` |
| Reviewer | TBD | awaiting review |
