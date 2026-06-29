# HIPAA Compliance Checklist

> Maps each HIPAA Security Rule requirement to a control in this
> repository and to the corresponding plan task. Status is the
> state as of the last update; refresh on every release.
>
> Source authority: 45 CFR Part 164 (HIPAA Security Rule).
> Specifically: §164.308 (administrative), §164.310 (physical),
> §164.312 (technical).

| Status | Meaning |
|--------|---------|
| ✅ | Control implemented and verified |
| 🟡 | Control implemented, not yet formally audited |
| 🚧 | Control in progress (see task) |
| ⛔ | Gap — must be addressed before BAA / go-live |
| N/A | Not applicable to E-Logbook's deployment model |

---

## §164.308 — Administrative Safeguards

| § | Standard | Implementation | Status | Plan |
|---|---------|---------------|--------|------|
| 164.308(a)(1)(i) | Security management — risk analysis | Annual pen-test (`docs/compliance/pen-test-report-template.md`); supplier risk review | 🟡 | P7.5 |
| 164.308(a)(1)(ii) | Risk management | `ENTERPRISE_TRANSFORMATION_PLAN.md`; `SECURITY.md`; review with each release | 🟡 | continuous |
| 164.308(a)(1)(iii) | Sanction policy | HR + security team runbook | N/A | — |
| 164.308(a)(1)(iv) | Information system activity review | `audit_logs` append-only; `audit_config_change` trigger; Sentry alerts | ✅ | P0.7, P0.8, P1.4 |
| 164.308(a)(2) | Assigned security responsibility | @mahmo (security lead); @ciso (accountable) | ✅ | — |
| 164.308(a)(3) | Workforce security | `get_user_role()` + RLS; least-privilege grant model | ✅ | P0.6, P2.0–P2.22 |
| 164.308(a)(4) | Information access management | RLS + JWT claim-based `tenant_id`; `FORCE RLS` on every table | ✅ | P0.6, P2.1 |
| 164.308(a)(5) | Security awareness and training | Onboarding checklist; SOC2 partner training | 🟡 | — |
| 164.308(a)(6) | Security incident procedures | `docs/postmortems/` template; on-call rotation | 🟡 | P6.10 |
| 164.308(a)(7) | Contingency plan | PITR enabled (P7.6); daily Supabase backups; RTO ≤4h, RPO ≤1h | 🟡 | P7.6, P8.2 |
| 164.308(a)(8) | Evaluation | Annual third-party pen-test; this checklist refreshed quarterly | 🟡 | P7.5 |
| 164.308(b)(1) | Business associate contracts | BAA template maintained; sub-processor list in privacy notice | 🚧 | P7.5 step 5 |

## §164.310 — Physical Safeguards

| § | Standard | Implementation | Status | Plan |
|---|---------|---------------|--------|------|
| 164.310(a)(1) | Facility access controls | Vercel + Supabase physical controls (vendor SOC2) | ✅ | inherited |
| 164.310(b) | Workstation use | Mobile device management (MDM) for institution staff — institutional | N/A | — |
| 164.310(c) | Workstation security | SQLCipher on mobile (P5.5); biometric gate (P5.6); screenshot prevention (P5.7); certificate pinning (P5.14) | ✅ | P5.5–P5.7, P5.14 |
| 164.310(d)(1) | Device and media controls | SecureStore key escrow with on-logout wipe; encrypted backup cadence | ✅ | P5.5 |

## §164.312 — Technical Safeguards (the core of the audit)

| § | Standard | Implementation | Status | Plan |
|---|---------|---------------|--------|------|
| **164.312(a)(1)** | **Access control — unique user identification** | Supabase Auth; UUID primary keys; `profiles.user_id` ↔ `auth.users.id`; `get_user_role()` UDF | ✅ | P1.4, P2.0 |
| **164.312(a)(2)(i)** | **Emergency access procedure** | `admin` role bypasses tenant scope; documented in `docs/operations.md` incident section | 🟡 | P7.5 |
| **164.312(a)(2)(ii)** | **Automatic logoff** | `auth.sessions.timebox = 28800` (8h); `inactivity_timeout = 1800` (30 min) | ✅ | P2.16 |
| **164.312(a)(2)(iii)** | **Encryption and decryption at rest** | pgcrypto `pgp_sym_encrypt` for `ai_config` and `payment_gateway_config` secrets (P2.1); versioned keys with rotation (P7.7); SQLCipher on mobile (P5.5) | ✅ | P2.1, P5.5, P7.7 |
| **164.312(a)(2)(iv)** | **Encryption in transit** | TLS 1.3 enforced at Vercel + Supabase edge; HSTS preload; `STRICT-TRANSPORT-SECURITY`; mobile uses TLS 1.3 with certificate pinning | ✅ | P4.2, P5.14 |
| **164.312(b)** | **Audit controls** | `audit_logs` table — append-only (P0.8); redaction (P0.7); `audit_config_change` trigger; reviewed weekly | ✅ | P0.7, P0.8, P1.4 |
| **164.312(c)(1)** | **Integrity — protect from improper alteration** | `audit_logs` BEFORE UPDATE/DELETE trigger raises; `append_only` enforcement | ✅ | P0.8 |
| **164.312(c)(2)** | **Mechanism to authenticate ePHI** | SHA-256 patient hash (P0.11); per-tenant salt in `tenants.mrn_hash_salt`; HMAC for AI response cache | ✅ | P0.11, P2.20 |
| **164.312(d)** | **Person or entity authentication** | Supabase Auth + MFA (TOTP) for director+ (P6.1) | ✅ | P6.1 |
| **164.312(e)(1)** | **Transmission security** | TLS 1.3; certificate pinning on mobile (P5.14) | ✅ | P5.14 |
| **164.312(e)(2)(i)** | **Integrity controls** | Signed webhooks (Stripe HMAC); payload checksums for case-attachments | ✅ | P2.11, P4.x |
| **164.312(e)(2)(ii)** | **Encryption during transmission** | Same as (e)(1) | ✅ | P5.14 |

## §164.316 — Documentation

| § | Standard | Implementation | Status | Plan |
|---|---------|---------------|--------|------|
| 164.316(b)(1) | Maintain policies and procedures | `SECURITY.md`, `ENTERPRISE_TRANSFORMATION_PLAN.md`, this checklist | ✅ | continuous |
| 164.316(b)(2) | Retain for 6 years | Git history (indefinite); privacy notice references this | ✅ | inherited |
| 164.316(b)(2)(ii) | Make available | This repo, internal share | ✅ | — |

---

## Refresh cadence

| Trigger | Action |
|---------|--------|
| Every release | Re-walk this checklist; bump "Last reviewed" date |
| Quarterly | Internal compliance review |
| Annually | External pen-test (P7.5) |
| Any change to PHI processing | Re-run DPIA (`docs/compliance/dpia-template.md`) |
