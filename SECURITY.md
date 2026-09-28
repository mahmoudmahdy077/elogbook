# Security Policy

## Reporting a vulnerability

The E-Logbook team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

**Please DO NOT file a public issue for security bugs.** Instead:

**Email:** `security@elogbook.example` (replace with the monitored production mailbox before launch)
**PGP key:** Not configured; publish a reviewed key before relying on encrypted email
**Target response window:** acknowledgement within 72 hours and a triage plan within 14 days, subject to owner confirmation

When reporting, please include:

1. A clear description of the vulnerability
2. Steps to reproduce (or a proof-of-concept)
3. The impact / potential severity
4. Any known mitigations or workarounds
5. Your name / handle for the credit list (if you want attribution)

## Scope

**In scope:**

- Source code in this repository (web, mobile, shared, supabase)
- Edge Functions deployed from this repository
- The production web app (`https://app.elogbook.example`) and the production mobile app (TestFlight / Play Store builds)
- Authentication, authorization, RLS, audit, cryptographic safeguards, sync, AI, billing

**Out of scope:**

- Third-party services (Supabase, Stripe, Paddle, LemonSqueezy, OpenAI, Anthropic) — please report directly to the vendor
- The `supabase start` local development stack
- Demo accounts (they have no real data)
- Physical / social-engineering attacks against team members
- Denial-of-service attacks against production infrastructure
- Reports from automated scanners without a manual reproduction

## Safe harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, or service disruption
- Only interact with accounts they own or have explicit permission to access
- Stop testing immediately if they encounter real PHI or PII and report the finding without retaining it
- Do not exploit a vulnerability beyond what is necessary to demonstrate it

## Severity classification

We use CVSS v3.1. Severity is determined by impact × exploitability × scope.

| Severity | Examples | SLA |
|----------|----------|-----|
| **Critical** | PHI exposure, RCE, auth bypass | Fix within 7 days; embargoed release |
| **High** | Privilege escalation, data corruption | Fix within 30 days |
| **Medium** | Information disclosure, XSS | Fix within 90 days |
| **Low** | CSRF on read-only, header injection | Fix in next minor release |

## Recognition

We maintain a security acknowledgments page for researchers who report valid issues (with their consent). No bounty commitment is published; any future program requires separate approval and terms.

## Security architecture overview

- **Database:** Reviewed tenant-scoped tables use RLS and `FORCE RLS`; the maintained catalog and negative policy suites verify the intended scope. Audit coverage is control-specific and uses metadata-only records for covered tables; it is not a blanket audit of every PHI read. Data-at-rest protection is limited to the field, secret, backup, or provider mechanism named by linked evidence; this repository does not claim blanket TDE or whole-database encryption.
- **Application:** Server components and route handlers verify authentication, tenant context, role, status, and request bounds. Client-side subscription state is not authorization evidence. Cross-tenant denials and selected security events are reviewable, subject to the coverage described in the [threat model](docs/security/threat-model.md).
- **API:** State-changing routes use the shared [request guard](apps/web/lib/http/request-guard.ts), schema validation, origin/content-type checks, bounded bodies, and rate limits where implemented. Route coverage is checked by [`scripts/verify-request-guards.mjs`](scripts/verify-request-guards.mjs).
- **Edge functions:** Authenticated functions derive context from the request and database; service-role use is limited to reviewed server paths. AI requests remain de-identified, tenant-scoped, budgeted, and schema-validated by [`supabase/functions/_shared/ai-guard.ts`](supabase/functions/_shared/ai-guard.ts).
- **Mobile:** Field-level AEAD covers explicitly sealed local fields only. The production plaintext SQLite path is disabled pending verified SQLCipher evidence; biometrics, screenshot prevention, SecureStore token handling, and native certificate decisions remain release-gated as described in [`docs/security/mobile-native-security.md`](docs/security/mobile-native-security.md).
- **Web:** CSP, frame restrictions, cookie attributes, and security headers are implemented and regression-tested; deployment configuration and provider evidence remain part of release qualification.
- **Backups and vendors:** Backup durability requires approved encryption, remote checksum verification, and a disposable restore drill. Vendor/BAA status remains `pending` until the accountable owner records the legal and security review in [`docs/compliance/vendor-register.yaml`](docs/compliance/vendor-register.yaml).

These statements describe repository controls and evidence; they do not claim HIPAA, GDPR, SOC 2, or other legal certification. Provider configuration, BAAs, legal review, workforce evidence, and independent testing remain external requirements.

## Compliance artifacts

| Artifact | Location |
|----------|----------|
| HIPAA control matrix | [`docs/compliance/hipaa-control-matrix.yaml`](docs/compliance/hipaa-control-matrix.yaml) |
| Vendor and BAA register | [`docs/compliance/vendor-register.yaml`](docs/compliance/vendor-register.yaml) |
| Security overview | [`docs/compliance/security-overview.md`](docs/compliance/security-overview.md) |
| HIPAA-aware controls and limitations | [`docs/compliance/hipaa.md`](docs/compliance/hipaa.md) |
| GDPR-aware rights and vendor notes | [`docs/compliance/gdpr.md`](docs/compliance/gdpr.md) |
| Threat model | [`docs/security/threat-model.md`](docs/security/threat-model.md) |
| Access review procedure | [`docs/security/access-review.md`](docs/security/access-review.md) |
| Retention and deletion baseline | [`docs/security/retention-policy.md`](docs/security/retention-policy.md) |
| Operating cadence | [`docs/security/operating-cadence.md`](docs/security/operating-cadence.md) |
| Exception register | [`docs/security/exception-register.yaml`](docs/security/exception-register.yaml) |

The evidence validator is run by security CI:

```bash
node scripts/verify-compliance-evidence.mjs
```

It rejects missing control fields, ownerless controls, missing evidence paths, expired exceptions, and unsupported affirmative security claims without repository evidence links. Findings are redacted and deterministic; the validator is not a certification process.

## Out-of-band disclosures

For coordinated disclosure (CVE assignment, embargoed releases, multi-vendor issues), email `security@elogbook.example` with the subject line starting with `[COORDINATED]`.
