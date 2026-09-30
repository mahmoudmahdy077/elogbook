# Access review procedure

**Status:** Draft operating procedure — not certified
**Review date:** 2026-09-24
**Accountable owner:** Security and Privacy Operations
**Technical owner:** Identity Engineering

## Purpose

Review workforce, service, vendor, and automated-principal access at least quarterly and before a production promotion. The review proves that access is attributable, tenant-scoped, minimum-necessary, and removable. It does not by itself establish regulatory compliance or a BAA.

## Review scope

The reviewer exports or queries the approved access sources and checks:

- Supabase Auth users, profile status, tenant membership, roles, and MFA assurance;
- platform and institution administrators;
- service-role and provider integrations, including last use and owning team;
- CI jobs, deploy environments, mobile build identities, support access, and break-glass accounts;
- vendor accounts and subprocessors listed in the [vendor register](../compliance/vendor-register.yaml);
- local mobile sessions, pending capabilities, and production storage state;
- open exceptions and access changes since the previous review.

Raw tokens, password values, connection strings, patient values, and full audit payloads must not be copied into the review record. Use IDs, role names, timestamps, and redacted findings.

## Review steps

1. **Prepare:** Identity Engineering exports a point-in-time access inventory and links it to the release commit, review date, and approved evidence location.
2. **Reconcile:** Compare workforce and service accounts with HR ownership, application roles, CI identities, vendor entries, and the [HIPAA control matrix](../compliance/hipaa-control-matrix.yaml).
3. **Test privilege:** Run the relevant authorization tests and database policy tests, including anonymous, cross-tenant, suspended-principal, and AAL2 negative cases. The primary references are [security context](../../apps/web/lib/supabase/security-context.ts), [policy convergence](../../supabase/tests/p1_21_policy_convergence.sql), and [mobile authorization](../../apps/mobile/lib/authorization.ts).
4. **Remove:** Revoke stale sessions, service credentials, role assignments, and vendor access through the approved provider and application paths. Record the action ID and timestamp, not the secret.
5. **Approve:** The accountable owner and an independent reviewer sign the review record in the approved evidence system. Repository documentation records only the decision, scope, owner, and artifact reference.
6. **Follow up:** Record unresolved items in [the exception register](exception-register.yaml) with a compensating control and expiry. An expired exception fails [the compliance evidence validator](../../scripts/verify-compliance-evidence.mjs).

## Required evidence

Each review record must include:

- review ID, reviewer, accountable owner, start/end dates, and environment scope;
- source export or query references and their SHA-256 digest;
- role/status changes, revocations, and approved exceptions;
- test or CI run references for authorization, RLS, MFA, session, and tenant-scope checks;
- confirmation that no credential or PHI value was copied into the record;
- next review date and escalation owner.

The repository references for this procedure are [SECURITY.md](../../SECURITY.md), [security-context tests](../../apps/web/lib/supabase/__tests__/security-context.test.ts), [mobile security tests](../../apps/mobile/lib/security/__tests__/mobile-security.test.ts), and [the threat model](threat-model.md).

## Frequency and triggers

- **Quarterly:** full workforce, service, vendor, and privileged-access review.
- **Monthly:** sample high-risk role changes, failed authorization events, and access exceptions through [the operating cadence](operating-cadence.md).
- **Before release:** verify deployment identities, protected environments, release approvers, and vendor changes.
- **After an incident:** review all identities and credentials in the incident scope before restoring normal operations.
- **On termination or role change:** revoke access immediately, including sessions and mobile capabilities.

## Current evidence and blockers

The current repository provides code and test references, not proof of workforce completion, provider access exports, BAA execution, or environment reviewer configuration. Those items remain assigned in [the exception register](exception-register.yaml), including vendor/legal review, training completion, mobile qualification, and release attestation.

Field-level AEAD coverage for selected mobile values is documented in [the mobile security decision](mobile-native-security.md). That evidence does not establish whole-database encryption; the production plaintext SQLite path remains disabled pending the mobile exception review.
