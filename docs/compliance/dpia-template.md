# Data Protection Impact Assessment (DPIA) — Template

> A DPIA is required under GDPR Art. 35 for processing likely to
> result in a high risk to the rights and freedoms of natural
> persons. E-Logbook processes PHI, so this is mandatory before
> launching in any new jurisdiction and on any material scope change.
> Copy to `docs/compliance/dpia-<feature>.md` and commit alongside
> the feature.

## 0. Metadata

| Field | Value |
|-------|-------|
| Feature / change | <feature name> |
| Author | @handle |
| Reviewed by (DPO) | |
| Approved by | |
| DPIA version | |
| Date | YYYY-MM-DD |
| Linked PRD | <link> |
| Linked pen-test report | <link or N/A> |
| Linked DPIA (prior version) | <link or N/A — "initial"> |

## 1. Necessity & proportionality

### 1.1 What?

Describe the processing operation: categories of data, categories
of data subjects, the system's role (controller / processor /
sub-processor), and the high-level purpose.

### 1.2 Why?

Is the processing necessary for the stated purpose? Is there a
less-invasive way to achieve the same outcome? (e.g. pseudonymisation,
on-device inference, no logging.)

### 1.3 How much?

Estimate the data subject population, the data volume per subject,
and the retention period.

## 2. Data flow

Draw or describe the flow. Include cross-border transfers, sub-
processors, and the controls at each boundary.

```
[Data subject]
   │  TLS 1.3 (mobile app, web)
   ▼
[Vercel edge]  ← CSP, HSTS, frame-ancestors 'none'
   │
   ▼
[Next.js / Edge Function]  ← RLS, Zod validation, Origin check, rate-limit
   │
   ├─► [Supabase Postgres]  ← FORCE RLS, pgcrypto, audit_logs (append-only)
   │     └─► [Supabase Storage]  ← case-attachments, consent-pdfs
   │
   ├─► [AI provider — OpenAI / Anthropic]  ← de-identified prompt,
   │     residency=Zurich, no-train flag
   │
   └─► [Payment provider — Stripe / Paddle / LemonSqueezy]
            ← DPA in place, no PHI shared
```

## 3. Lawful basis (GDPR Art. 6 + Art. 9)

| Category | Lawful basis | Documented in |
|----------|--------------|---------------|
| Patient data (PHI) | Art. 9(2)(h) — preventive medicine / occupational health; Art. 9(2)(c) — vital interests (emergency access) | `docs/compliance/hipaa-checklist.md` for HIPAA side; consent_records for Art. 9(2)(a) withdrawal flow |
| Resident / staff data | Art. 6(1)(b) contract; Art. 6(1)(f) legitimate interest (security logs) | employment contract + privacy notice |
| Audit logs (cross-tenant) | Art. 6(1)(c) legal obligation (HIPAA §164.312(b)) | `docs/operations.md` |
| AI prompts | Art. 6(1)(a) explicit consent (de-identified anyway) | `consent_records` table |

## 4. Risks to data subjects

Rate each risk by likelihood × severity (low / medium / high).
"Residual" is the rating after the listed mitigations.

| # | Risk | Subject impact | Likelihood | Severity | Initial | Mitigation | Residual | Owner |
|---|------|---------------|-----------|----------|---------|-----------|----------|-------|
| R1 | Cross-tenant PHI exposure via RLS bypass | Discrimination, identity theft | Low | High | Medium | FORCE RLS on every table (P0.6); RLS test suite (`supabase test db`); CodeQL + Semgrep | Low | @mahmo |
| R2 | Mobile app loss → unencrypted PHI on device | Identity theft | Medium | High | High | SQLCipher (P5.5); biometric gate (P5.6); screenshot prevention (P5.7); remote wipe via SecureStore reset on logout | Low | @mahmo |
| R3 | AI provider retains / trains on prompts | Re-identification of patient | Low | High | Medium | De-identification pre-prompt; no-train flag at provider; AI insights quota enforcement (P2.3) | Low | @mahmo |
| R4 | Excessive data retention | Stale PHI exposure | Low | Medium | Low | `enforce_data_retention` cron (P2.21); tenant-scoped retention in `tenants.data_retention_days` | Low | @mahmo |
| R5 | Insufficient breach notification | Regulatory + reputational | Low | High | Medium | `incident_response_plan.md`; alert on `audit_logs` anomalies; on-call rota | Low | @mahmo |
| R6 | Sub-processor breach (e.g. Stripe) | Reputational, contractual | Low | High | Medium | DPAs with each sub-processor; sub-processor list in privacy notice | Low | @legal |
| R7 | Logging PHI in browser / Edge Function logs | Insider threat | Medium | Medium | Medium | No PHI in logs (P0.12, P1.0); redaction tests | Low | @mahmo |
| R8 | Insecure dev / staging envs | Same as prod | Medium | High | High | No real PHI in non-prod; quarterly env scrub; separate Supabase projects | Low | @mahmo |

## 5. Consultation

| Stakeholder | Consulted | Outcome |
|-------------|-----------|---------|
| Data Protection Officer | yes / no / N/A | |
| Legal | yes / no | |
| Works council (EEA) | yes / no / N/A | |
| Patient / clinician representatives | yes / no | |
| Information Security | yes | |

## 6. International transfers (GDPR Ch. V)

List each cross-border transfer and its safeguard:

| Transfer | Destination | Safeguard | Mechanism |
|----------|-------------|-----------|-----------|
| Patient PHI → Supabase EU region (e.g. `aws-eu-central-1`) | EU | intra-EEA | SCC not required |
| AI prompt → OpenAI (US) | US | de-identified; no PHI in prompt | EU-US Data Privacy Framework; SCC fallback for non-covered sub-processors |
| Stripe — payment only, no PHI | US | contract | SCC |

## 7. Retention & erasure

- Default retention: configurable per tenant (`tenants.data_retention_days`,
  default 2555 days = 7 years per HIPAA).
- Erasure endpoint: `DELETE /api/profile/me` — hard-deletes profile
  + soft-deletes case_entries + erases field_values.
- Automated purge: cron job `enforce_data_retention` runs daily.

## 8. Rights of the data subject

| Right (Art.) | Endpoint / mechanism | Notes |
|--------------|----------------------|-------|
| Access (Art. 15) | `GET /api/profile/me/export` | returns JSON + PDF |
| Rectification (Art. 16) | `PATCH /api/profile/me` | name, contact |
| Erasure (Art. 17) | `DELETE /api/profile/me` | soft-delete; clinical data retained per Art. 17(3)(b) |
| Restriction (Art. 18) | `POST /api/profile/me/restrict` | sets `processing_restricted=true` |
| Portability (Art. 20) | `GET /api/profile/me/export?format=json` | machine-readable |
| Object (Art. 21) | `POST /api/profile/me/object` | |
| Automated decision (Art. 22) | N/A — no automated decisions on the data subject | AI outputs are advisory only, reviewed by a clinician |

## 9. Decision

| Option | Choose one |
|--------|-----------|
| Proceed as planned | |
| Proceed with conditions (list conditions) | |
| Consult supervisory authority (Art. 36) | |
| Do not proceed | |

## 10. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Author | | | |
| DPO | | | |
| Engineering lead | | | |
| Product owner | | | |
| Legal | | | |
| CISO | | | |

## 11. Review schedule

Re-run this DPIA on any of:
- New category of personal data introduced.
- New processing purpose.
- New sub-processor.
- New region / country.
- Material change to retention, transfer mechanism, or security controls.
- Annual review (default: every 12 months).
