# Service-role credential exposure — 2026-09-23

## Status

Local release containment implemented. External credential rotation and revocation verification remain required before production deployment or real ePHI processing.

## Owner

Security/release owner

## Timeline

- **2026-09-23 — Discovery:** A suspected production service-role credential exposure was identified. Credential values are recorded only as `[REDACTED]`.
- **2026-09-23 — Scope assessment:** Production deployment automation, database migration/function deployment, and backup automation were assessed for credential reachability. Staging, preview, development, and pull-request checks remain in scope for continued non-production use.
- **2026-09-23 — Containment decision:** Independent production deployment on pushes to `main` was frozen. Production promotion now requires explicit protected workflow dispatch and an approved promotion input after the unified release gate.
- **2026-09-23 — Verification:** A local containment gate was added to detect unsafe production triggers and destructive setup, update, or backup routes that are not explicitly isolated.

## Affected credential classes

- Supabase service-role credential: `[REDACTED]`
- Production database and backup credentials reachable by release automation: `[REDACTED]`
- CI and deployment-provider credentials potentially exposed through the same workflow trust boundary: `[REDACTED]`

No credential value, token, connection string, environment-variable value, or local environment-file content is included in this record.

## Containment decision

- Keep normal CI, development, preview, and staging behavior enabled.
- Permit production deployment jobs only through `workflow_dispatch` with a required `approved_promotion` input and the protected `production` environment.
- Do not deploy or process real ePHI until the suspected service-role credential and dependent credentials are rotated or revoked, and the old credential is proven invalid.
- Require destructive `/api/setup`, `/api/update`, and `/api/backup` route references in production deployment workflows to carry an explicit `RELEASE_CONTAINMENT_ROUTE: isolated` marker.
- Preserve workflow audit history; do not reset, clean, stash, or overwrite unrelated worktree changes.

## Evidence checklist

- [x] Release containment fixture passes with `node --test tests/security/verify-release-containment.test.mjs`.
- [x] Current-tree release containment check passes with `node scripts/verify-release-containment.mjs`.
- [x] Modified workflow YAML parses successfully.
- [ ] GitHub production environment protection requires the security/release owner or another authorized approver.
- [ ] Unified release-gate evidence identifies the exact release commit and successful required checks.
- [ ] Provider-side rotation or revocation evidence confirms the old service-role credential is invalid.
- [ ] Dependent database, backup, CI, and deployment-provider credentials have documented disposition.
- [ ] Repository and workflow audit evidence contains no credential values.

## Operator action required

- Rotate or revoke the suspected Supabase service-role credential: `[REDACTED]`.
- Rotate or revoke every dependent credential identified by provider-side access review.
- Verify rejection of the old service-role credential without recording request or response credentials.
- Enable and evidence required reviewer protection for the GitHub `production` environment.
- Attach provider, repository, and protected-environment audit evidence to the incident record using the organization-approved evidence store.
- Record any unresolved exposure, suspected ePHI impact, or notification obligation through the authorized incident-response process.
