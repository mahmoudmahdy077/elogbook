# GDPR Compliance Checklist

> Maps each in-scope GDPR article to a control in this repository
> and to the corresponding plan task. Status is the state as of the
> last update; refresh on every release and on any new feature that
> touches personal data.
>
> Source authority: Regulation (EU) 2016/679 (GDPR).
>
> Status legend: see `hipaa-checklist.md` for the same set.

---

## Art. 5 — Principles relating to processing of personal data

| Paragraph | Requirement | Implementation | Status | Plan |
|-----------|-------------|---------------|--------|------|
| 5(1)(a) | Lawfulness, fairness, transparency | Privacy notice in-app; consent_records table; lawful basis matrix in `dpia-template.md` §3 | 🟡 | P7.5 |
| 5(1)(b) | Purpose limitation | `tenants.processing_purposes` JSONB; no secondary use without re-consent | 🟡 | P3.13 |
| 5(1)(c) | Data minimisation | Schema review: every column is necessary; `field_values` is structured Zod-validated | ✅ | P3.0 |
| 5(1)(d) | Accuracy | Edit API on every relevant entity; audit trail of changes | ✅ | P0.8 |
| 5(1)(e) | Storage limitation | `tenants.data_retention_days` per-tenant; `enforce_data_retention` cron | ✅ | P2.21 |
| 5(1)(f) | Integrity & confidentiality | pgcrypto, SQLCipher, RLS, MFA, audit_logs | ✅ | P0.6, P2.1, P5.5 |
| 5(2) | Accountability | This checklist + DPIA + pen-test reports | 🟡 | P7.5 |

## Art. 7 — Conditions for consent

| Paragraph | Requirement | Implementation | Status | Plan |
|-----------|-------------|---------------|--------|------|
| 7(1) | Demonstrate consent | `consent_records` (purpose, granted_at, withdrawn_at, version of notice) | ✅ | P1.4 |
| 7(2) | Freely given, specific, informed, unambiguous | Consent UI is per-purpose, granular; no pre-checked boxes | 🟡 | P6.0 |
| 7(3) | Right to withdraw | `POST /api/consent/withdraw`; revocation timestamp | ✅ | P1.4 |
| 7(4) | Consent must not be a precondition | Patient access is gated on consent but not on a paid plan; non-consent users are not denied emergency access (Art. 9(2)(c)) | ✅ | P2.0 |

## Art. 9 — Special categories (health data)

| Paragraph | Requirement | Implementation | Status | Plan |
|-----------|-------------|---------------|--------|------|
| 9(2)(a) | Explicit consent | `consent_records` per purpose; explicit click-to-consent UI | 🟡 | P1.4, P6.0 |
| 9(2)(c) | Vital interests | Break-the-glass emergency access path is documented (`docs/operations.md`); break-the-glass event writes an `audit_logs` row tagged `emergency_access` | 🟡 | P7.5 |
| 9(2)(h) | Preventive medicine / occupational health | Primary lawful basis for clinical use; documented in DPIA §3 | 🟡 | P7.5 |
| 9(2)(i) | Public interest in health | N/A (not a public-health authority) | N/A | — |

## Art. 12–14 — Transparent information

| Article | Requirement | Implementation | Status | Plan |
|---------|-------------|---------------|--------|------|
| 12 | Concise, transparent, intelligible, easily accessible | Layered privacy notice; plain-language summary first | 🟡 | P6.0 |
| 13 | Information to be provided where data is collected from the subject | In-app consent screen references the full notice URL | 🟡 | P6.0 |
| 14 | Information where data is not collected from the subject | Sub-processor list in the privacy notice | ✅ | inherited |

## Art. 15 — Right of access

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Subject can obtain a copy of their data | `GET /api/profile/me/export` (JSON + PDF) | ✅ | P6.0 |
| Free of charge, within 1 month | Documented in `docs/operations.md` | 🟡 | P7.5 |

## Art. 17 — Right to erasure

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Erasure on request | `DELETE /api/profile/me` — soft-deletes profile, erases `field_values`, anonymises `case_entries` | ✅ | P0.6, P6.0 |
| Exceptions (17(3)) — clinical record retention | 7-year retention in HIPAA countries; `data_retention_days` overrides | ✅ | P2.21 |

## Art. 20 — Right to data portability

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Structured, commonly used, machine-readable format | `GET /api/profile/me/export?format=json` | ✅ | P6.0 |
| Transmit directly to another controller | "Download" + email delivery | 🟡 | P6.0 |

## Art. 25 — Data protection by design and by default

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Privacy by design | FORCE RLS (P0.6); encryption at rest (P2.1); append-only audit (P0.8); PHI never in `localStorage` (P0.12); no PHI in console (P0.12, P1.0) | ✅ | P0.x, P2.x |
| Privacy by default | Default tenant retention = 7y; default role on invite = `resident`; MFA off until user opts in (then on for director+) | 🟡 | P6.1 |

## Art. 28 — Processor

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| DPA with each sub-processor | DPAs on file with Supabase, Vercel, Stripe, OpenAI, Sentry | 🟡 | P7.5 step 5 |
| Sub-processor list published | Privacy notice references `docs/compliance/sub-processors.md` (TBD) | 🟡 | P7.5 |
| Right to audit | DPAs include audit rights | 🟡 | — |

## Art. 30 — Records of processing activities (ROPA)

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Controller ROPA | Maintained as `docs/compliance/ropa.md` (TBD; one row per processing activity) | 🟡 | P7.5 |
| Includes categories of recipients, transfers, retention | This checklist + DPIA + sub-processor list | 🟡 | — |

## Art. 32 — Security of processing

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Pseudonymisation | `patient_hash` (SHA-256, per-tenant salt); `patient_mrn` itself is not stored in web | ✅ | P0.11, P2.20 |
| Encryption at rest | pgcrypto (P2.1); SQLCipher (P5.5) | ✅ | P2.1, P5.5 |
| Encryption in transit | TLS 1.3; cert pinning (P5.14) | ✅ | P5.14 |
| Ongoing CIA | `audit_logs` (P0.8); `audit_config_change` (P0.7); Sentry; Supabase log drains | ✅ | P0.x, P1.4 |
| Regular testing | Annual pen-test (P7.5); `supabase test db`; CI with CodeQL/Semgrep/ZAP/Trivy (P7.x) | ✅ | P7.0–P7.5 |
| Risk assessment | This checklist; DPIA per feature | 🟡 | P7.5 |

## Art. 33 — Breach notification (authority)

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Notify supervisory authority within 72h | Incident runbook in `docs/operations.md`; Slack #incidents on-call | 🟡 | P6.10 |
| Document all breaches (even those not reported) | `audit_logs.anomaly = true` flag; postmortem template | 🟡 | P6.10 |

## Art. 34 — Breach notification (data subject)

| Requirement | Implementation | Status | Plan |
|-------------|---------------|--------|------|
| Notify affected subjects "without undue delay" | Email + in-app banner template | 🟡 | P6.10 |
| Exception: encrypted data (34(3)(a)) | pgcrypto + SQLCipher + key rotation satisfies this | ✅ | P7.7 |

---

## Cross-cutting controls

- **DPIA** — `docs/compliance/dpia-template.md` (P7.5) — required for
  any new high-risk processing.
- **Pen-test** — `docs/compliance/pen-test-report-template.md`
  (P7.5) — annual + on material change.
- **Pen-test follow-up** — all `Critical` and `High` findings must
  reach `verified` status within 30 / 90 days respectively.
- **Sub-processor list** — `docs/compliance/sub-processors.md` (TBD).
- **ROPA** — `docs/compliance/ropa.md` (TBD).

## Refresh cadence

| Trigger | Action |
|---------|--------|
| Every release | Re-walk this checklist |
| Quarterly | Compliance review meeting |
| Annually | External pen-test + DPIA refresh |
| Any new feature that touches personal data | Update this checklist and (if high-risk) a new DPIA |
| Any new sub-processor | Update `sub-processors.md` + DPIA Art. 28 row |
