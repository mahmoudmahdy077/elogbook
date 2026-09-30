# Security threat model

**Status:** Draft — not certified
**Review date:** 2026-09-24
**Owners:** Security Engineering, Database Engineering, Privacy and Compliance

## Purpose and limits

This model describes the threats addressed by repository controls and the evidence required to verify them. It is a technical risk model, not a HIPAA certification, legal opinion, penetration-test report, or production-readiness declaration. Deployment configuration, provider agreements, workforce evidence, and independent testing remain external evidence requirements.

## Scope and assets

The system handles multi-tenant clinical records, authentication and tenant metadata, attachments, audit metadata, billing and email metadata, AI inputs and outputs, mobile local state, backups, and release artifacts. The highest-impact assets are:

- ePHI and tenant-scoped clinical records;
- authentication sessions, MFA assurance, and service-role credentials;
- attachment objects and scan state;
- audit and incident evidence;
- cryptographic keys, webhook secrets, signing material, and provider credentials;
- mobile local databases and device-bound keys;
- release workflows, lockfiles, SBOMs, and deployment artifacts.

Sensitive values are never copied into this document, tests, issue text, or ordinary logs. See the [incident record](incidents/2026-09-23-service-role-exposure.md) and [secret containment gate](../../scripts/verify-secret-containment.mjs).

## Trust boundaries

1. **Browser or mobile client to web application:** client input, identifiers, redirects, uploads, and claims are untrusted. Server routes enforce origin, content type, body limits, authentication, authorization, and schema checks through [the request guard](../../apps/web/lib/http/request-guard.ts).
2. **Web application to Supabase Auth and Postgres:** the server derives identity and status from the authenticated session and database. RLS, `FORCE RLS`, tenant predicates, and active-status helpers are tested in [the principal-status migration](../../supabase/migrations/20260923000002_authoritative_principal_status.sql) and [the policy regression suite](../../supabase/tests/p1_21_policy_convergence.sql).
3. **Application to Edge Functions and AI providers:** provider egress is bounded by the shared outbound policy. AI inputs must be de-identified, tenant-scoped, budgeted, and schema-validated by [the AI guard](../../supabase/functions/_shared/ai-guard.ts).
4. **Attachment client to private storage:** browser clients do not receive direct clinical Storage mutation privileges. Uploads are rejected before storage while the approved scanner registry is empty. A future reviewed connector may create durable `pending` state, but objects remain unavailable until an authorized release transition exists; see [scanner configuration](../../apps/web/lib/attachments/scanner-config.ts), [the forward gate migration](../../supabase/migrations/20260925000006_attachment_scanner_release_gate.sql), and [the broker boundary test](../../tests/security/attachment-broker-boundary.test.mjs).
5. **Release workstation or CI to production:** production promotion is dispatch-only, least-privilege, and dependent on security gates. Deterministic inventory is reproducible source evidence, not promotion evidence. Provenance and artifacts must be signed and verified, a commit-bound attestation must pass its external verifier, and production environment controls must be independently verified; current evidence remains unsigned/pending.
6. **Production to email, backup, vendor, and monitoring services:** contracts, payload minimization, webhook integrity, KMS/object-lock controls, retention, region, subprocessors, and access controls are not inferred from code. They are tracked in the [vendor register](../compliance/vendor-register.yaml) and [exception register](exception-register.yaml).

## Threats and controls

| Threat | Primary controls | Verification evidence | Residual decision |
|---|---|---|---|
| Cross-tenant read or write | Database-derived tenant context, operation-specific RLS, `FORCE RLS`, status checks, RPC scoping | [principal-status migration](../../supabase/migrations/20260923000002_authoritative_principal_status.sql), [policy tests](../../supabase/tests/p1_18_principal_status_rls.sql), [policy convergence tests](../../supabase/tests/p1_21_policy_convergence.sql) | Run the full migration replay on a disposable Supabase instance before promotion |
| Stale or suspended principal access | Server security context, active account/tenant checks, session revocation, AAL2 for privileged actions | [security context](../../apps/web/lib/supabase/security-context.ts), [session revocation](../../apps/web/lib/supabase/session-revocation.ts), [mobile security tests](../../apps/mobile/lib/security/__tests__/mobile-security.test.ts) | Provider-side session invalidation and workforce review still require operator evidence |
| Service-role credential exposure | Secret containment, server-only service adapters, production containment, rotation runbook | [secret scanner](../../scripts/verify-secret-containment.mjs), [release containment gate](../../scripts/verify-release-containment.mjs), [incident record](incidents/2026-09-23-service-role-exposure.md) | Provider rotation and old-credential rejection are open external blockers |
| SSRF through webhooks, AI, or integrations | HTTPS and host policy, DNS/IP validation, bounded response, no redirects by default, reviewed exemptions | [outbound URL policy](../../packages/shared/src/security/outbound-url.ts), [request guard](../../apps/web/lib/http/request-guard.ts), [route coverage gate](../../scripts/verify-request-guards.mjs) | Provider and egress allowlists require deployment configuration |
| Malware or unsafe attachment release | Pre-storage rejection while no approved connector exists, server broker, durable pending-state RPC, bounded scanner adapter, privileged-transition gating, and owner/role authorization | [scanner configuration](../../apps/web/lib/attachments/scanner-config.ts), [processor](../../supabase/functions/process-attachment/index.ts), [forward gate migration](../../supabase/migrations/20260925000006_attachment_scanner_release_gate.sql), [attachment tests](../../tests/security/attachment-broker-boundary.test.mjs) | Scanner selection, real connector isolation, BAA posture, and release-transition evidence are pending |
| PHI or secret leakage through audit, logs, errors, or AI output | Metadata-only audit allowlist, recursive redaction, bounded event context, schema validation | [metadata audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql), [redaction tests](../../apps/web/lib/__tests__/logger.observability.test.ts), [Edge logging tests](../../supabase/functions/_shared/logging.test.ts) | Observability vendor retention and BAA review remain pending |
| Mobile plaintext database or token exposure | Production storage guard, SecureStore boundary, field-level AEAD for covered fields, network-security artifacts | [mobile decision](mobile-native-security.md), [mobile gate](../../scripts/verify-mobile-security.mjs), [mobile tests](../../apps/mobile/lib/security/__tests__/mobile-security.test.ts) | SQLCipher, pin, and iOS trust evidence are not yet established; offline clinical storage remains disabled |
| Unsafe email delivery, replay, or PHI leakage | Metadata-only operational templates, bounded payload/recipient validation, mandatory pre-send audit, scoped preferences, signed allowlisted webhooks, replay handling, and sanitized provider errors | [email safety](../../packages/shared/src/email/safety.ts), [email webhook policy](../../packages/shared/src/email/webhook.ts), [email containment tests](../../tests/security/email-containment.test.mjs) | Resend/SMTP ePHI eligibility, retention, subprocessors, and BAA status remain pending |
| Supply-chain or release substitution | Full action SHAs, image digests, Deno lock, frozen install, SBOM, deterministic inventory, required signatures, commit-bound attestation, and production-control verification | [supply-chain gate](../../scripts/verify-pinned-supply-chain.mjs), [release evidence verifier](../../scripts/verify-release-evidence.mjs), [release path gate](../../scripts/verify-single-release-path.mjs) | External signing, attestation, and protected production-environment evidence are pending |
| Backup loss or unverified restore | Discrete connection settings, pre-dump KMS identity verification, encryption hook, private permissions, remote checksum, per-object lock verification, and disposable restore target | [backup flow tests](../../tests/security/backup-flow.test.mjs), [backup strategy](../backup-strategy.md), [restore runbook](../upgrade/runbooks/restore.md) | Storage provider, KMS, object-lock implementation, BAA, and measured RPO/RTO evidence are open |
| Workforce or vendor misuse | Least privilege, access review, training assignment, vendor register, incident escalation | [access review](access-review.md), [operating cadence](operating-cadence.md), [vendor register](../compliance/vendor-register.yaml) | Training completion and legal/vendor approvals are external evidence |

## Security invariants

- Missing, ambiguous, suspended, or cross-tenant context denies access.
- Client claims, local flags, model output, and repository instructions never grant authority.
- Service-role credentials are server-only, narrowly scoped, redacted, and rotatable through an operator process.
- Attachment bytes are rejected before storage while no approved scanner connector exists; any future stored object remains unavailable until an authorized, reviewed release transition is recorded.
- Email delivery requires bounded payload validation, suppression/preferences, a pre-send audit record, and verified provider webhook processing; provider errors and event logs remain metadata-only.
- Outbound requests do not reach private, loopback, link-local, metadata, or unapproved destinations.
- Audit records contain identifiers and changed-field names, not full clinical rows or arbitrary nested payloads. This is control-specific coverage; it is not a claim that every PHI read is exhaustively audited.
- Encryption claims are limited to the field, secret, backup, or provider mechanism named by the linked evidence. No blanket TDE or whole-database encryption claim is made by this model.
- Production release evidence is unsigned/pending unless artifacts and provenance are signed and verified, a commit-bound attestation passes its verifier, and production environment controls are independently verified.

## Abuse cases requiring review

1. A tenant administrator changes a profile or role in another tenant through REST, RPC, Storage, or an Edge Function.
2. A suspended user reuses a session, refresh token, mobile capability, or cached local record.
3. A webhook or AI configuration resolves to a private address, changes DNS between validation and connection, or redirects across hosts.
4. An attachment changes content after upload, bypasses the broker, is downloaded while quarantined, or is released without a clean scan result.
5. An audit, error, Sentry, or model-provider payload contains a patient identifier, token, cookie, or nested clinical value.
6. A backup reports durable success without pre-dump KMS verification, remote checksum verification, or object-lock enforcement, or a restore is attempted outside a disposable target.
7. An email sender bypasses suppression, payload bounds, pre-send audit, signature verification, replay controls, or metadata-only event handling; see [the email webhook policy](../../packages/shared/src/email/webhook.ts).
8. A vendor, workforce member, or CI job receives more data or authority than the approved access review records.

## Risk acceptance and review

Open risks are tracked in [the exception register](exception-register.yaml) with an owner, compensating controls, review date, and expiry. Expired exceptions fail [the compliance evidence validator](../../scripts/verify-compliance-evidence.mjs). A reviewer must either renew the exception with current evidence, reduce the exposure, or close the affected control before the expiry date.
