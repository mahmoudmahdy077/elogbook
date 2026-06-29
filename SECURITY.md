# Security Policy

## Reporting a vulnerability

The E-Logbook team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

**Please DO NOT file a public issue for security bugs.** Instead:

📧 **Email:** `security@elogbook.example`
🔐 **PGP key:** `<key-fingerprint-or-paste-here>`
⏱️ **Response SLA:** within 72 hours (acknowledgement), within 14 days (triage + fix plan)

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
- Authentication, authorization, RLS, audit, encryption, sync, AI, billing

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

We maintain a security acknowledgments page for researchers who report valid issues (with their consent). Significant findings are eligible for our responsible-disclosure bounty program (TBD).

## Security architecture overview

- **Database:** Row-level security (FORCE RLS) on every tenant-scoped table; audit_logs is append-only; PHI is hashed/encrypted at rest.
- **Application:** Server components verify auth; client components respect subscription read-only state; cross-tenant access audited.
- **API:** Server actions validated with Zod; CSRF via Origin/Referer check; rate-limited per-user via DB-backed `check_rate_limit` RPC.
- **Edge functions:** Authenticated via Supabase JWT; service_role only for admin operations; SSE streaming with safety guardrails for AI.
- **Mobile:** SQLCipher at rest; biometrics gate; screenshot prevention; certificate pinning; SecureStore for tokens.
- **Web:** CSP with nonce + `strict-dynamic`; `frame-ancestors 'none'`; `SameSite=Lax` cookies; explicit `Secure`/`HttpOnly`.

## Compliance artifacts

| Artifact | Location |
|----------|----------|
| Penetration test report template | [`docs/compliance/pen-test-report-template.md`](docs/compliance/pen-test-report-template.md) |
| Data Protection Impact Assessment (DPIA) template | [`docs/compliance/dpia-template.md`](docs/compliance/dpia-template.md) |
| HIPAA Security Rule checklist | [`docs/compliance/hipaa-checklist.md`](docs/compliance/hipaa-checklist.md) |
| GDPR Article-by-article checklist | [`docs/compliance/gdpr-checklist.md`](docs/compliance/gdpr-checklist.md) |

Past pen-test reports are kept under `docs/compliance/pen-test-YYYY-MM-DD-<vendor>.md`
and treated as confidential (do not push to a public fork).

## Out-of-band disclosures

For coordinated disclosure (CVE assignment, embargoed releases, multi-vendor issues), email `security@elogbook.example` with the subject line starting with `[COORDINATED]`.
