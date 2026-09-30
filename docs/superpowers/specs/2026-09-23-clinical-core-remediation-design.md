# Clinical Core Vertical-Slice Remediation Design

**Date:** 2026-09-23  
**Status:** Approved in design review; pending written-spec review  
**Scope:** First implementation slice of the complete remediation roadmap  
**Target topology:** One self-hosted Linux VPS behind Caddy, with the app and Supabase services on the qualified host profile  
**Data boundary for this slice:** Synthetic/de-identified web workflow only

This design is a focused implementation contract derived from `ELOGBOOK_MASTER_UPGRADE_PLAN.md` and `docs/superpowers/specs/2026-09-23-enterprise-security-hardening-design.md`. It sequences the clinical workflow first while keeping the broader enterprise, identifiable-data, operations, and mobile tracks dependent on explicit gates.

## 1. Decision summary

The first slice qualifies one complete clinical journey:

```text
operator-provisioned tenant
  -> invited resident
  -> de-identified case draft
  -> validated submission
  -> supervisor approval or reasoned rejection
  -> resident sees the decision
  -> director sees an aggregate program report
```

The implementation preserves the current product UI and the existing dirty working tree. It does not reset or discard uncommitted work. Clinical state changes use authenticated route handlers backed by narrow, transactional database commands. Browser-to-database reads remain protected by RLS; clinical writes do not remain direct browser inserts or updates.

The following work is explicitly sequenced after this slice:

- Tenant administration and platform administration.
- Email, push, webhooks, billing, AI, SSO/SCIM, uploads, and public-page publishing.
- Self-hosting manager GUI, update orchestration, backup automation, and restore qualification.
- Identifiable clinical mode and jurisdiction-specific compliance enablement.
- Mobile/offline synchronization and native release qualification.

## 2. Current risk evidence

The audit verdict for the current tree is **20/100: blocked**. The following findings are release blockers and are inputs to this design:

- An unexpired Supabase `service_role` JWT is present in three tracked `.hermes` scripts reachable from `origin/main`. Secret values are intentionally not reproduced. Treat the credential as compromised until rotated and verified invalid. Evidence: `.hermes/swarm/staff-workflows.mjs:6`, `.hermes/swarm/staff-workflows-cleanup.mjs:5`, `.hermes/swarm/staff-workflows-tombstone-svc.mjs:3`.
- Permissive role-only policies can omit tenant predicates, including profile, subscription, tenant-settings, and webhook paths. Evidence: `supabase/migrations/00002_rls_policies.sql:117-120,415-449` and `supabase/migrations/20260818140000_admin_user_management.sql:68-97`.
- Offline sync security-definer functions use nullable tenant comparisons and inherited execution privileges. Evidence: `supabase/migrations/20260821000000_offline_sync_support.sql:81-225` and `supabase/migrations/20260909000003_case_operation_rpc.sql:254-257`.
- Public signup can consume an email-only invite and accepts user-controlled role metadata. Evidence: `supabase/migrations/20260818150000_fix_handle_new_user_global_tenant.sql:14-72` and `apps/web/app/signup/SignupForm.tsx:40-55`.
- The web case form inserts a case directly with the initial status and does not create approval requests. Evidence: `apps/web/components/CaseForm.tsx:281-381`.
- The logger rewrite changes the public logging contract and currently causes TypeScript and test failures. Evidence: `apps/web/lib/logger.ts:67-155`.
- The migration history contains diagnostic/isolation migrations, and the current release workflow has allowed red checks to coexist with deployment. Evidence: `supabase/migrations/20260825200000_temp_iso_p3.sql:1-56` and `.github/workflows/cd.yml:28-99`.

These findings are not all fixed by the clinical slice. The slice cannot be released until the containment and database gates in Sections 5 and 8 pass.

## 3. Goals and non-goals

### Goals

1. Make resident-to-supervisor-to-director workflow atomic, idempotent, tenant-scoped, and observable.
2. Enforce required template fields and de-identification rules on both client and server.
3. Enforce active account, active tenant, role, ownership, and AAL2 requirements at authoritative boundaries.
4. Remove clinical payloads from audit records and ordinary telemetry.
5. Make the critical path verifiable on a clean self-hosted qualification environment.
6. Preserve current user-facing structure while repairing incorrect state transitions and failure messages.

### Non-goals for this slice

- Mobile installation, offline synchronization, native artifacts, or push delivery.
- Public paid checkout, self-service billing, or plan administration.
- AI processing, custom AI endpoints, tenant webhooks, or external clinical data egress.
- General-purpose setup, Docker-socket, host-update, or backup-management interfaces.
- Identifiable patient records, MRN/DOB entry, or `patient_hash` generation.
- A broad visual redesign, token rewrite, or replacement of the existing Supabase access model.
- Editing or squashing already-applied migration history without an inventory and a separately qualified clean-baseline plan.

## 4. User journey and acceptance contract

The slice is accepted only when all of the following succeed with synthetic data:

1. An operator creates or adopts one tenant and one initial institution administrator through a controlled provisioning path.
2. The administrator issues a single-use, expiring invitation for a resident and supervisor.
3. Each invited user authenticates, lands in the correct tenant, and cannot choose a role through client metadata.
4. The resident selects a General Surgery template, completes every required field, and saves a de-identified draft.
5. The resident submits the draft. The database creates the approval request(s), changes the case to `pending`, and records one idempotent result.
6. A supervisor sees only cases in their tenant and assigned review scope, approves or rejects with a reason, and cannot act on a stale case version.
7. The resident sees the final state and reason without receiving another user's data.
8. A director sees an aggregate report for the tenant and cannot read unrelated tenants or private resident fields outside the report policy.
9. A suspended resident, suspended supervisor, suspended tenant, anonymous principal, and forged tenant/role payload are denied at REST, RPC, and route boundaries.
10. A retry of any command returns the original result or a deterministic conflict; it never duplicates a case, approval request, audit event, or outbox event.

The first slice uses operator-delivered invitations if the email worker is not yet qualified. A failed email provider must not create a second account or silently consume an invitation.

## 5. Security and data design

### 5.1 Containment preconditions

Before any deployment or identifiable-data work:

- Revoke and rotate the exposed Supabase service-role credential and any dependent credentials.
- Verify that the old credential receives an authentication failure.
- Remove secret values from tracked and reachable artifacts; history cleanup is secondary to rotation and must not be treated as a substitute.
- Add a blocking secret scan covering the repository, history, build artifacts, and generated reports.
- Protect `main` and prevent CD from running when any required verification job fails.
- Record the incident owner, affected systems, review window, and evidence location without storing the credential.

External credential rotation, GitHub settings, and host changes require explicit operator approval immediately before execution.

### 5.2 Authorization and lifecycle

- Derive actor, profile, tenant, role, and account status from the authenticated database identity, never from request payloads.
- Require active profile and active tenant status in every tenant-scoped RLS policy and security-definer command.
- Scope all institution-admin policies to the caller's tenant. Reserve global operations for the explicit platform-admin registry or a service-role-only server path.
- Revoke `PUBLIC` and `anon` execution from all sensitive functions. Grant only the minimum signature to `authenticated` where appropriate.
- Revoke session access when an account or tenant is suspended. Existing direct REST, RPC, Storage, and Edge paths must fail closed.
- Require server-verified AAL2 for supervisor decisions, exports, administrative actions, and future operations. Client MFA state is informational only.
- Protect the last active administrator and prevent self-reactivation through ordinary profile updates.

### 5.3 Invitations and identity

- Store only a hash of each invitation token, with tenant, normalized email, role, expiry, and single-use state.
- Bind the token to the intended tenant and role. Never derive a privileged role from ordinary signup metadata.
- Consume an invitation atomically only after the intended identity is verified.
- Provision exactly one profile for an Auth user. The route must not insert a second profile after the signup trigger has already created one.
- Do not place unrelated public users in a shared clinical tenant.

### 5.4 Clinical data boundary

- The first slice exposes only age band or other approved synthetic/de-identified fields; it does not expose MRN, DOB, or patient-hash generation.
- Reject identifiable payloads in both route validation and database commands while the effective tenant policy is de-identified.
- Audit only opaque resource IDs, action, actor, tenant, result, and changed-field names. Never serialize full `field_values`, identifiers, prompts, comments, or raw database errors.
- Keep PHI out of URLs, browser storage, logs, analytics, traces, webhook payloads, email, and external AI providers.
- Use a durable outbox for state-dependent notifications. Delivery failure cannot change the already-committed clinical state.

### 5.5 Secret and outbound-request policy

- Keep service-role and encryption material in server-only secret storage; never commit or expose them to browser bundles or repository-controlled scripts.
- Until their dedicated tracks qualify, disable public signup, self-activation of paid plans, custom AI endpoints, tenant webhook test endpoints, and other untrusted outbound integrations.
- Any later outbound integration must use HTTPS, explicit provider allowlists, DNS A/AAAA validation, private-range rejection, redirect revalidation or no redirects, bounded timeouts, response-size limits, and sanitized errors.

## 6. Component and data-flow design

### 6.1 Command boundary

Expose three narrow authenticated route handlers:

| Command | Allowed actor | Required result |
| --- | --- | --- |
| `save_case_draft` | Resident owner; explicitly authorized privileged roles | Validated draft with a stable case ID and version |
| `submit_case` | Draft owner | Locked transition to `pending`, approval requests, audit, and outbox rows |
| `decide_case` | Assigned supervisor/director or explicitly authorized reviewer | Locked approval/rejection, reason, version check, audit, and outbox row |

The handlers perform request-level origin validation, body limits, strict schema validation, rate limiting, session checks, and AAL2 checks where required. The database remains authoritative for tenant, role, ownership, status, data mode, template requirements, and state transitions.

### 6.2 Database command rules

Each command must:

1. Reject unauthenticated, inactive, cross-tenant, and malformed requests.
2. Derive tenant and actor from `auth.uid()` and current database records.
3. Lock the target case or approval request with a tenant predicate.
4. Validate expected state/version and return a conflict instead of overwriting a newer change.
5. Validate required template fields using the stored template definition.
6. Enforce the effective data mode and subscription/policy requirements.
7. Write the clinical mutation, audit record, and outbox record atomically.
8. Scope idempotency by tenant, actor, command, and request ID.
9. Return stable error codes and minimal response data.

The existing broad mobile `submit_case_operation` path is not reused unchanged for the web workflow. It is either adapted to the new command contract or retired after its callers are migrated. Its current behavior includes incomplete approval side effects, globally scoped operation IDs, and broad payload handling.

### 6.3 State model

```text
draft -> pending -> approved
                  -> rejected -> draft (after resident correction/resubmission)
```

Individual-tenant behavior, if retained, must be an explicit server-side branch that creates a real approved state and records the reason. A tenant type must never merely return `auto_approved: true` while leaving a case pending.

Required approval recipients are derived from the tenant's active supervisor/director assignments. A case with no eligible reviewer fails closed and remains a draft with an actionable error; it is never silently marked submitted.

### 6.4 Outbox and delivery

Clinical commands write opaque outbox events in the same transaction. Notification, email, webhook, and push workers are separate consumers with claim/lease, retry, dead-letter, and idempotency behavior. Until a worker is qualified, events remain inspectable and the clinical slice does not claim delivery completion.

## 7. Error handling and observability

The API maps stable internal errors to safe responses:

| Internal code | HTTP status | Meaning |
| --- | --- | --- |
| `required_field_missing` | 422 | Stored template requirements failed |
| `tenant_suspended` | 403 | Tenant lifecycle forbids the operation |
| `account_inactive` | 403 | User lifecycle forbids the operation |
| `forbidden` | 403 | Actor lacks ownership or role authority |
| `not_found` | 404 | Resource is absent within the caller's scope |
| `state_conflict` | 409 | State/version changed concurrently |
| `idempotency_conflict` | 409 | Request key was reused with different input |
| `policy_denied` | 403 | Effective data or subscription policy denies the operation |
| `internal_error` | 500 | Unexpected failure with a correlation ID |

No raw SQL, Auth, provider, or filesystem error is returned to the user. Server logs contain a request/correlation ID, opaque resource IDs, command name, duration, and result category. They exclude clinical payloads and secrets. Metrics cover command latency, conflict rate, denial rate, outbox age, failed deliveries, and readiness state.

## 8. Implementation sequence and release gates

### Phase 0 — Containment and baseline

- Rotate/revoke the exposed credential and verify the old value fails.
- Protect the branch and couple CD to the exact verified commit.
- Repair the logger API regression without weakening recursive PHI/secret redaction.
- Make typecheck, lint, unit, and focused security checks deterministic.
- Inventory the current migration state before changing deployed history.

**Exit gate:** no known exposed credential remains valid; the working tree builds; no deployment can bypass failed checks.

### Phase 1 — Database authorization repair

- Add negative catalog/pgTAP tests for anonymous, cross-tenant, suspended, forged-role, and `PUBLIC` execution paths.
- Revoke or replace unsafe sync and dashboard/duty functions.
- Scope every institution-admin policy to its tenant.
- Enforce active account/tenant state and AAL2 at authoritative boundaries.
- Replace clinical audit serialization with allowlisted metadata.

**Exit gate:** final-schema tests prove no anonymous or cross-tenant path in the reviewed REST/RPC/Storage/Edge surface.

### Phase 2 — Clinical commands

- Add failing route, schema, and pgTAP tests for all three commands.
- Implement `save_case_draft`, `submit_case`, and `decide_case` with idempotency and row locking.
- Add approval-request creation, rejection reason, state/version conflict, and outbox behavior.
- Run a clean migration replay from an empty database.

**Exit gate:** the resident→supervisor→director transaction works against a real disposable Supabase stack, with negative cases passing.

### Phase 3 — Client integration and usability repair

- Route CaseForm, QuickAddCase, approval actions, and reports through the command handlers.
- Load and enforce `required_fields`; remove the current pending-on-save behavior.
- Correct tenant slug handling, notification ownership, and state-specific error/empty/loading behavior.
- Keep the current visual language; do not mix a broad redesign into the security repair.

**Exit gate:** no production caller performs a direct clinical state mutation, and the critical journey works on desktop and mobile widths.

### Phase 4 — Qualification and controlled release

- Run the full non-skipped Playwright journey in an isolated environment.
- Run authenticated accessibility, keyboard, and responsive checks.
- Build and boot the qualified Caddy/Next/Supabase VPS profile; require `/api/ready` to return 200.
- Verify encrypted off-host backup, checksum, isolated restore, session invalidation, and tenant isolation after restore.
- Publish an evidence manifest tied to the exact commit and artifact digests.

**Exit gate:** all required checks are green, no critical/high security finding is open, and the operator approves the release.

## 9. Full future-state roadmap after this slice

This slice is the first vertical qualification, not the complete product. Subsequent tracks reuse its security context, command conventions, outbox, audit, and evidence model:

1. Tenant/platform administration, lifecycle, invitations, support grants, and feature policy.
2. Email/notification provider integration with real queue workers and suppression.
3. Billing and plan entitlements with server-authoritative payment events.
4. SSO/SCIM and audited integration-secret storage.
5. Attachments, malware quarantine, export, PDF, and retention controls.
6. AI features behind consent, minimization, provider allowlists, and BAA/DPA review.
7. Branded/editorial surfaces with safe publishing and cache isolation.
8. Isolated self-hosting manager, durable updates, backup/restore automation, and rollback manifests.
9. Identifiable mode, field-level protection, key escrow/rotation, and compliance evidence.
10. Mobile offline durability, native security, device smoke tests, and app-store qualification.

Each track has its own design, threat model, migration plan, rollback class, and release evidence. Passing the clinical slice does not imply that a later track is production-ready.

## 10. Rollback and change management

- Production database changes are forward-only corrective migrations after a verified inventory; do not reset or rewrite an applied environment to hide a defect.
- Application rollback is allowed only when the schema remains backward compatible. Otherwise use a documented restore/recovery procedure.
- High-risk auth and RLS changes use a canary tenant, explicit maintenance criteria, and a second review.
- Secret rotation uses the shortest controlled overlap that permits verification, then revokes the old credential.
- Failed commands leave either the original state or a complete atomic result; no partial approval or notification state is accepted.
- All release artifacts, migration revisions, backups, and evidence are bound to one immutable commit.

## 11. Compliance boundary

This design creates technical controls and evidence; it does not certify HIPAA, GDPR, SCFHS, GMC, or any other legal/accreditation regime. Identifiable mode remains disabled until the operator completes applicable risk analysis, vendor/BAAs or DPAs, key custody, restore, access-review, incident-response, and external security qualification. Self-hosted Supabase is not treated as compliant by default.

## 12. Spec self-review

- **Placeholder scan:** No unresolved placeholder markers or incomplete requirements are used. Deferred tracks have explicit entry gates.
- **Consistency:** The command, data-mode, tenant, idempotency, audit, and release rules are consistent across sections.
- **Scope:** The document is limited to the first clinical vertical slice and names later tracks without implementing them.
- **Ambiguity:** Each accepted journey, actor, state transition, error category, and release gate has a concrete boundary.
- **Evidence discipline:** Secret values and PHI are not reproduced; source findings and required verification are distinguished.
