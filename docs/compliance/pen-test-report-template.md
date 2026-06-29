# Penetration Test Report — Template

> Copy this file to `docs/compliance/pen-test-YYYY-MM-DD-<vendor>.md`
> after each external engagement and commit the executed report to
> the repo. Treat pen-test reports as confidential (do not push to a
> public fork). Mark the commit with the `security` label only — no
> PHI in the diff.

## 1. Engagement metadata

| Field | Value |
|-------|-------|
| Vendor | |
| Lead tester | |
| Report version / date | |
| Engagement window | YYYY-MM-DD → YYYY-MM-DD |
| Test type | black-box / gray-box / white-box / targeted |
| Methodology | OWASP WSTG / NIST SP 800-115 / OSSTMM / PTES / vendor proprietary |
| Report classification | CONFIDENTIAL — Internal use only |
| Distribution list | @security-team, @ciso, @legal |
| Retest scheduled | YYYY-MM-DD (or N/A) |

## 2. Scope

### 2.1 In-scope assets

| Asset | URL / ID | Auth model | Notes |
|-------|----------|-----------|-------|
| Web app — production | `https://app.elogbook.example` | cookie (Supabase) | |
| Web app — staging | `https://staging.elogbook.example` | cookie (Supabase) | |
| Mobile app — iOS | `itms-apps://apps.apple.com/...` | SecureStore token | build SHA `…` |
| Mobile app — Android | `https://play.google.com/...` | SecureStore token | build SHA `…` |
| Edge function — `ai-insights` | `https://<ref>.supabase.co/functions/v1/ai-insights` | JWT (service_role or user) | |
| Edge function — `generate-pdf` | same | JWT | |
| Edge function — `payment-webhook` | same | HMAC | |
| Edge function — `create-checkout` | same | JWT | |
| Supabase REST API | `https://<ref>.supabase.co/rest/v1` | JWT | PostgREST |
| Supabase Storage | `https://<ref>.supabase.co/storage/v1` | JWT | buckets: `case-attachments`, `consent-pdfs` |

### 2.2 Out-of-scope assets

- Third-party services (Supabase platform, Stripe, OpenAI, Paddle,
  LemonSqueezy, Sentry) — reported to the vendor directly.
- Physical / social-engineering attacks.
- DoS / volumetric load testing (handled by the load-test plan in
  Phase 8 P8.0).
- Insider threats beyond what is testable from a single compromised
  account.

## 3. Test accounts provided

| Role | Email | Pre-provisioned? | Notes |
|------|-------|------------------|-------|
| Resident | `pentest-resident@elogbook.example` | yes | seeded with sample cases |
| Supervisor | `pentest-supervisor@elogbook.example` | yes | |
| Director | `pentest-director@elogbook.example` | yes | |
| Institution admin | `pentest-admin@elogbook.example` | yes | MFA enrolled |
| Cross-tenant | `pentest-tenantB-…` | yes | to verify isolation |

All test accounts are scrubbed from the production tenant at the
end of the engagement.

## 4. Findings

Severity uses CVSS v3.1 (Base Score → Severity). Status follows
the lifecycle: `open` → `in_progress` → `fixed` → `verified` (by
retest) → `accepted` (with risk acceptance document).

### 4.1 Summary

| Severity | Count open | Count in progress | Count fixed (not yet retested) | Count verified | Count accepted |
|----------|------------|--------------------|--------------------------------|----------------|----------------|
| Critical | | | | | |
| High | | | | | |
| Medium | | | | | |
| Low | | | | | |
| Informational | | | | | |
| **Total** | | | | | |

### 4.2 Finding — <TITLE>

| Field | Value |
|-------|-------|
| ID | ELOG-PT-YYYY-NNN |
| Severity | Critical / High / Medium / Low / Info |
| CVSS | 9.8 (vector) |
| Affected asset(s) | |
| CWE | CWE-XXX |
| OWASP category | A01:2021 / A02:2021 / … |
| Status | open / in_progress / fixed / verified / accepted |
| Discovered by | <tester handle> |
| Discovered on | YYYY-MM-DD |
| Fixed by | @handle |
| Fixed in | commit SHA / release tag |
| Verified by (retest) | |

#### Description

<free-form description of the vulnerability, the impact, and the
exploit path. Be precise; assume the reader is the engineering team
that must fix it.>

#### Reproduction steps

1. <step>
2. <step>
3. <observed result>

#### Evidence

<screenshots, request/response captures, payloads — sanitized of
real PHI and live secrets. Attach as a separate encrypted bundle
referenced by hash.>

#### Remediation recommendation

<technical fix, with code pointers if applicable>

#### Remediation status

<commit SHA, PR link, or risk-acceptance doc ID>

### 4.x Finding — <TITLE>

… (repeat for each finding) …

## 5. Out-of-band / coordinated disclosure

Were any of the findings coordinated with an external party (CVE
authority, vendor security team, other affected party)? List the
advisories and CVE IDs reserved.

| CVE | Vendor | Status | Advisory URL |
|-----|--------|--------|--------------|
| CVE-YYYY-NNNNN | Supabase | disclosed | |

## 6. Strengths observed

<list things the tester's report explicitly calls out as done well.
This is valuable input to SECURITY.md.>

## 7. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Lead tester (vendor) | | | |
| E-Logbook security lead | | | |
| E-Logbook CISO / accountable | | | |
| Engineering lead (remediation) | | | |
| Legal (review of disclosure) | | | |

## 8. Appendices

- A. Raw tool output (Nuclei, Burp, sqlmap, custom scripts).
- B. Glossary.
- C. Sanitized evidence bundle (commit hash + checksum).
