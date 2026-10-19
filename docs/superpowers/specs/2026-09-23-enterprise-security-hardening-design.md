# Enterprise Security Hardening Design

**Design status:** Approved 2026-09-23
**Target:** HIPAA/ePHI-aware enterprise production security
**Strategy:** Staged security program
**Scope:** Web, mobile, Supabase database and Edge Functions, AI surfaces, CI/CD, deployment, backups, observability, and agent/tool configuration

---

## 1. Security objective and non-negotiable invariants

The project must be treated as a multi-tenant clinical system handling electronic protected health information (ePHI), even where a deployment is currently a demo or staging environment. Security controls must fail closed, be enforced server-side and in the database, and be independently verified rather than relying on an AI agent instruction or UI control.

The following invariants govern every phase:

1. An unauthenticated principal cannot read or mutate clinical or tenant data.
2. A principal authenticated for Tenant A cannot read, mutate, export, attach to, or infer data belonging to Tenant B.
3. Suspended users and suspended tenants lose access immediately, including existing sessions and direct REST/RPC access.
4. Privileged actions require a server-verified active account and AAL2 session; client claims and local flags are never authorization evidence.
5. Service-role credentials are server-only, narrowly scoped where possible, never committed, never logged, and rotatable without application downtime.
6. All external input is untrusted. User content, retrieved content, model output, webhook data, and repository instructions cannot directly become privileged actions.
7. Outbound network requests cannot reach private, loopback, link-local, metadata, or otherwise unapproved destinations.
8. Uploads and generated documents are untrusted until validated, quarantined, scanned, and explicitly released.
9. PHI, secrets, raw model prompts/responses, and sensitive errors do not enter client-visible errors, ordinary logs, analytics, traces, or external AI providers.
10. Every security-relevant build and deployment is reproducible, scanned, signed or attested, and gated by passing tests.
11. Security changes are staged, observable, reversible, and supported by evidence retained under the approved HIPAA/legal retention policy.

## 2. Research synthesis

The local audit found recurring “vibe coding” failure classes that are directly relevant to this repository: broken access control and tenant isolation, authentication/session gaps, SSRF, unsafe uploads, missing or weak CSRF/rate limits, hardcoded or broadly exposed credentials, PHI leakage through logs/audit payloads, mutable supply-chain references, weak release gating, and AI surfaces that can exceed their intended authority.

Recent external research reinforces that these must be treated as system properties, not developer reminders:

- The 2026 study *Understanding the (In)Security of Vibe-Coded Applications* reports that 91.0% of 200 audited public applications contained at least one vulnerability, with critical/high findings concentrated in broken access control, injection, and authentication failures: <https://arxiv.org/abs/2606.23130>.
- OWASP GenAI Security Project’s 2026 LLM Top 10 places prompt injection, sensitive information disclosure, excessive agency, supply chain, unbounded consumption, hidden context exposure, and improper output handling among the principal application and agent risks: <https://genai.owasp.org/llm-top-10/> and <https://github.com/GenAI-Security-Project/GenAI-LLM-Top10>.
- OWASP’s agentic guidance emphasizes least agency, complete mediation, human approval for high-impact actions, sandboxing, egress controls, and auditable tool use: <https://genai.owasp.org/download/52117>.
- NIST SSDF organizes controls around preparing the organization, protecting the software, producing well-secured software, and responding to vulnerabilities: <https://csrc.nist.gov/pubs/sp/800/218/final>.
- CISA’s 2026 SBOM guidance treats the SBOM as a software-supply-chain security artifact, with a need for component inventory and provenance: <https://www.cisa.gov/resources-tools/resources/2026-minimum-elements-software-bill-materials-sbom>.
- HHS emphasizes risk analysis, minimum-necessary access, audit controls, access management, transmission security, contingency planning, and periodic reassessment for ePHI: <https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html>.
- Supabase’s shared-responsibility guidance states that self-hosted HIPAA controls are not provided out of the box and that the customer remains responsible for configuration, BAAs, policies, and operational safeguards: <https://supabase.com/docs/guides/security/hipaa-compliance>.

These sources are design inputs, not a substitute for a live database permission check, penetration test, vendor review, or legal/compliance sign-off.

## 3. Current evidence and risk register

The following findings are source-confirmed in the current repository or migration history. Deployment-dependent items are explicitly marked. Secrets are intentionally not reproduced.

### 3.1 Stop-ship and critical findings

- **Suspected production service-role credential exposure:** local ignored environment files and untracked security reports contain JWT-shaped service-role values and claims of real production credentials. Treat the old key as compromised until rotated and verified invalid. Evidence: `.env.local`, `apps/web/.env.local`, `SECURITY_ALERT_ENV_SECRETS.md`, `SECURITY_HARDENING_PLAN.md`.
- **Unauthenticated/cross-tenant sync read risk:** `public.sync_pull_changes` is `SECURITY DEFINER`; a null tenant comparison can pass for anonymous callers and the function returns full rows from a caller-supplied tenant. Evidence: `supabase/migrations/20260821000000_offline_sync_support.sql:81-123`.
- **Cross-tenant sync write/reparenting risk:** retired `public.sync_push_batch` remains callable through inherited `PUBLIC` privileges and updates target rows by ID without a target-row tenant predicate. Evidence: `supabase/migrations/20260825110000_sync_push_batch_quota_row_skip.sql:18-77`, `supabase/migrations/20260909000003_case_operation_rpc.sql:257`.
- **Role-only tenant-admin RLS policies:** broad policies on profiles, subscriptions, tenant settings, subscription changes, and plan features do not consistently constrain institution administrators to their own tenant. Evidence: `supabase/migrations/00002_rls_policies.sql:117-120,430-434`, `supabase/migrations/20260818140000_admin_user_management.sql:69-92`.
- **Release integrity failure:** the current working tree has web typecheck failures and CD is not coupled to the security gates. Evidence: `.github/workflows/cd.yml`, `.github/workflows/ci.yml`, `apps/web/lib/logger.ts`, and the current typecheck result.

### 3.2 High findings

- Suspended/deactivated users retain sessions and some direct REST/RPC/RLS access; tenant suspension is not enforced database-wide.
- Webhook registration/test and custom AI endpoints permit SSRF, including DNS rebinding and redirect risks.
- Mobile privileged sessions do not consistently require AAL2.
- Clinical attachments rely on client-declared MIME/extension, lack a confirmed malware-clean gate, and have tenant-wide storage mutation policies.
- MFA redirect parameters can become an authenticated XSS navigation sink.
- Approval RPC domain failures are treated as successful mutations by web/mobile callers.
- Audit triggers serialize complete clinical rows and nested JSONB, creating a secondary PHI store.
- Webhook signing secrets can fall back to plaintext when encryption configuration is missing.
- CI actions, images, Deno imports, and SBOM tooling are not reproducibly pinned.
- Backup jobs can report success without durable encrypted external storage and pass database credentials through process arguments.
- Agent/configuration surfaces can enable automatic hooks, external MCP egress, and live-data diagnostic scripts.
- Several `SECURITY DEFINER` functions lack pinned `search_path` or explicit revoke/grant policies.
- Tenant-wide analytics, duty-hour, notification, rotation, shift, milestone, comment, and scholarly-activity policies are broader than the intended role/ownership model.

### 3.3 Medium and lower findings

- Negative AI quota counts, global operation IDs, one-shot retention, broad profile/evaluation writes, and incomplete `FORCE RLS` coverage create integrity and governance gaps.
- SSO responses echo client secrets, client regexes can cause ReDoS, and demo credentials remain in test/fallback paths.
- The mobile SQLCipher and certificate-pinning claims are not fully evidenced in the current native configuration.
- Local logger changes regressed recursive PHI redaction and send raw errors to external sinks.

## 4. Target architecture and controls

### 4.1 Identity, session, and authorization

- Centralize a server-side `SecurityContext` derived from Supabase Auth identity, JWT AAL, profile status/role, tenant status, and the platform-admin registry.
- Reject missing or ambiguous context. Never treat a role string from a client payload, `mfaVerifiedAt`, local storage, or an untrusted header as authorization.
- On user suspension, revoke sessions and enforce the status in middleware, RLS, RPCs, Storage policies, Edge Functions, and privileged routes.
- On tenant suspension, revoke tenant sessions and enforce tenant status in every tenant-scoped write path, including security-definer functions.
- Require AAL2 for platform administration, tenant administration, role changes, backup/restore, destructive operations, exports, and approval actions. Use explicit server-side step-up checks.
- Move backup, restore, uninstall, setup, and update operations to an isolated control plane. The web artifact must not expose Docker or host execution.
- Keep service-role access in a small, reviewed server-only module. Do not pass it to client code, Edge Functions that do not need it, or repository-controlled diagnostic scripts.

### 4.2 Database authorization and RLS convergence

- Add a new migration that revokes `PUBLIC` and `anon` privileges from all sensitive functions/tables, then grants only required privileges to explicitly reviewed roles.
- Drop or disable unsafe legacy sync functions. For any retained function, require authentication, derive tenant identity server-side, use null-safe comparisons, enforce target-row ownership, and constrain table/column allowlists.
- Split permissive `FOR ALL` policies into operation-specific policies with both `USING` and `WITH CHECK` predicates.
- Apply tenant predicates to every institution-admin policy. Reserve global authority for the platform-admin registry or an explicitly defined platform role.
- Enable and force RLS on every public table. Add a catalog test that fails when a table lacks RLS/FORCE RLS or when a security-definer function lacks a safe `search_path`.
- Pin all `SECURITY DEFINER` functions with `SET search_path = pg_catalog, public, pg_temp` or fully qualified references.
- Replace metadata-only audit payloads; never serialize full clinical rows or arbitrary nested JSONB. Add PHI redaction tests for names, emails, phone numbers, MRNs, dates, and nested fields.
- Remove plaintext fallback for webhook and other secrets. Fail closed when encryption keys are missing and migrate existing secrets only through an audited rotation job.
- Add positive ownership/role checks to evaluation, profile, notification, rotation, shift, milestone, comment, scholarly activity, and storage mutation paths.
- Make idempotency keys tenant/actor scoped and reject negative resource counts.

### 4.3 Web, API, and input boundary

- Apply a shared request guard to every state-changing route: origin/CSRF validation, body-size limit, strict content type, schema validation, rate limit, and safe error response.
- Replace raw client redirect parameters with `safeRelativePath` and a route allowlist. Reject `javascript:`, protocol-relative, encoded, and non-allowlisted destinations.
- Validate and cap all identifiers, strings, JSON, filenames, MIME types, and pagination parameters. Use parameterized database APIs.
- Sanitize or safely render user HTML; avoid dynamic code execution, `eval`, and unrestricted template execution.
- Return generic errors to users. Send stable event IDs and allowlisted structured context to observability systems.
- Restore recursive allowlist-based PHI/secret redaction in web and Edge Function logging. Add `beforeSend`/equivalent controls for external error reporting and explicitly scrub provider responses.

### 4.4 SSRF and outbound request policy

Create one outbound-request policy shared by webhooks, custom AI endpoints, URL fetchers, and future integrations:

- Require HTTPS in production and an explicit provider/tenant allowlist where possible.
- Resolve A/AAAA records and reject loopback, private, link-local, multicast, reserved, cloud metadata, and otherwise prohibited ranges, including alternate IP representations.
- Connect only to the validated address or use an egress proxy that enforces the same policy; revalidate on every redirect.
- Do not follow redirects by default. Never forward authorization, cookies, or internal headers across hosts.
- Apply strict timeouts, response-size limits, concurrency limits, and cancellation.
- Never return raw upstream response bodies to users; return a bounded status/error category only.

### 4.5 Upload and document security

- Remove ordinary direct clinical uploads from the browser. Use a server-side upload broker that authenticates the actor, checks tenant and object ownership, limits size/count, and ignores client MIME as authoritative.
- Store objects in private quarantine storage. Verify magic bytes and extension/content agreement, normalize or convert documents where safe, scan for malware, and record a signed status transition.
- Permit download only for `clean` objects, after an authorization check, with short-lived signed URLs, `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`.
- Restrict Storage update/delete to the uploader/owner or an explicitly authorized role. Metadata and object paths are not authorization by themselves.
- Retain scan results and audit events without storing malware content or PHI in ordinary logs.

### 4.6 AI and agent boundaries

- Treat user text, uploaded documents, retrieved pages, emails, webhooks, repository files, MCP responses, and peer-agent messages as untrusted data.
- Keep instructions and data structurally separate; do not rely on a system prompt as a security boundary.
- Validate model output with schemas before persistence, rendering, tool invocation, email, or external communication.
- Apply deterministic authorization at execution time, not only when the model selected a tool.
- Minimize tool permissions and autonomy. Expose narrow, typed operations instead of shell, arbitrary SQL, arbitrary HTTP, or broad mailbox/database tools.
- Require human approval for privileged, irreversible, financial, destructive, publishing, or externally visible actions. Show the exact action/diff, not a summary.
- Enforce token, cost, tool-call, fan-out, recursion, and wall-clock budgets. Add per-tenant and per-principal quotas.
- Do not allow model output to grant roles, change tenant scope, disable controls, approve its own action, or write durable instructions/memory without an independent review.
- Keep repository-controlled hooks, MCP configuration, extension files, and live-data scripts outside privileged production execution. Verify manifests and require explicit approval for external egress or writes.

### 4.7 Mobile security

- Use secure server-verified session assurance for privileged capabilities; block tenant-wide data and mutations at AAL1.
- Fail closed when account or tenant status is missing.
- Encrypt local clinical data with a reviewed SQLCipher/key-management design; do not ship a dormant plaintext adapter.
- Remove demo credential fallbacks and prevent demo banners in production.
- Verify native certificate/network-security configuration through generated artifacts and automated tests; document pin rotation.
- Add mobile SBOM, provenance, artifact digest verification, and reproducible build inputs.

### 4.8 Supply chain and release

- Establish one promotion path: typecheck, tests, migration replay, SAST, secret scan, dependency review/audit, container and function scanning, SBOM, staging smoke tests, human approval, and production deploy.
- Pin GitHub Actions to reviewed full commit SHAs, container/base images to digests, Supabase source to a reviewed commit/release, and Deno imports to locked versions.
- Commit Deno lockfiles and include Deno dependencies in the release SBOM. Remove `--no-lock` and `--no-check` from release verification.
- Set least-privilege workflow permissions and `persist-credentials: false` for checkout. Separate untrusted PR workflows from privileged deployment jobs.
- Remove debug/temp migrations and production test-data mutations. Add pre-deploy checks for debug objects, unsafe grants, missing RLS/FORCE RLS, and unpinned security-definer functions.
- Generate CycloneDX SBOMs and signed provenance/attestations for web, container, mobile, and Edge artifacts. Verify them against the release commit and lockfiles before deployment.
- Encrypt backups with managed keys, store them durably outside the host, use `PGPASSFILE`/secret injection instead of database URLs in process arguments, verify checksums, and run restore drills.

### 4.9 Observability, audit, and incident response

- Maintain an append-only security audit stream for authentication, authorization failures, PHI reads/exports, role changes, tenant lifecycle, admin actions, webhook/AI actions, upload state changes, and security-gate results.
- Use stable event IDs and allowlisted fields. Do not store full request/response bodies or raw model prompts by default.
- Retain audit/security records according to the approved legal policy, with six years as the HIPAA documentation baseline unless counsel/regulators specify a different schedule.
- Alert on cross-tenant denials, repeated auth failures, privilege changes, unusual exports, service-role use, queue abuse, secret-detection failures, backup failures, and artifact-verification failures.
- Maintain a HIPAA control matrix with control owner, implementation reference, test/evidence link, vendor/BAA status, review date, and exception expiry.
- Maintain a vendor register for Supabase, hosting/CDN, email, analytics, support, monitoring, AI, backup, and mobile distribution providers. No vendor receives ePHI without an approved legal/compliance posture.

## 5. Phased implementation and release gates

### Phase 0 — Containment and evidence preservation

1. Freeze production deployment and preserve only the minimum evidence needed for incident response.
2. Rotate/revoke the suspected Supabase service-role key and any dependent credentials; verify old credentials fail.
3. Remove secret-bearing reports from tracked/untracked reachable paths, rotate exposed values, and scan repository history and artifacts.
4. Add temporary CI secret scanning and protected-environment rules.

**Exit gate:** no known production credential remains valid; deployment is blocked until credential verification and incident ownership are recorded.

### Phase 1 — Database and identity isolation

1. Add negative privilege tests and catalog checks before changing policies.
2. Revoke/drop unsafe legacy RPCs and broad public/anon privileges.
3. Converge RLS/FORCE RLS, tenant predicates, role policies, storage policies, account/tenant suspension, MFA/AAL2, and audit redaction.
4. Replay migrations from an empty database and run cross-tenant/anonymous tests against the final schema.

**Exit gate:** no anonymous or cross-tenant read/write path exists in REST, RPC, Storage, or Edge Functions; suspended principals fail closed.

### Phase 2 — Application perimeter

1. Add shared request, redirect, outbound URL, upload, and logging guards.
2. Close SSRF, attachment, XSS, approval-integrity, CSRF, rate-limit, and PHI-logging findings.
3. Add mobile AAL2/status/encryption and demo-credential fixes.
4. Add adversarial tests for each confirmed finding.

**Exit gate:** security regression suite passes and no high-confidence exploit path remains in the reviewed surfaces.

### Phase 3 — Supply chain and operations

1. Pin and lock dependencies, actions, images, Deno imports, and scanners.
2. Couple deployment to all security gates; remove debug production history.
3. Add signed SBOM/provenance and artifact verification.
4. Encrypt and externalize backups; perform restore drill.

**Exit gate:** reproducible release and rollback evidence exists, and no deployment can bypass the security gates.

### Phase 4 — Compliance and continuous operations

1. Complete vendor/BAA review, HIPAA control matrix, threat model, incident runbooks, access-review cadence, and training evidence.
2. Schedule quarterly access reviews, dependency reviews, penetration tests, restore drills, and control reassessments.
3. Add dashboards and alerts for security and privacy KPIs.

**Exit gate:** owners approve residual risks, exceptions have expiry dates, and evidence is retained for the required period.

## 6. Testing and verification strategy

- **Database:** pgTAP and catalog tests for RLS/FORCE RLS, grants, `PUBLIC` execution, SECURITY DEFINER search paths, tenant isolation, account/tenant status, role boundaries, storage ownership, audit redaction, quotas, and idempotency.
- **Web/mobile:** Vitest/React Native tests for request guards, CSRF, redirects, MFA, SSRF policy, upload lifecycle, log redaction, and route authorization.
- **Integration:** mocked Supabase/Edge providers plus a disposable Supabase stack for real RLS/RPC behavior; no production credentials in test fixtures.
- **Dynamic:** OWASP ZAP against staging, dependency/container/function scans, secret scan across history/artifacts, and targeted manual authorization tests.
- **Supply chain:** clean-room install from frozen lockfiles, migration replay, SBOM comparison, provenance verification, and rollback rehearsal.
- **Operations:** backup encryption/decryption, checksum, restore, RPO/RTO, alert delivery, and incident tabletop exercises.
- **Acceptance evidence:** every control in the HIPAA matrix links to code, a passing test/CI job, and an owner-reviewed artifact.

## 7. Rollback and change management

- Every migration is forward-only, idempotent where possible, staged in a disposable environment, and reviewed by a second engineer/security reviewer.
- Never roll back by disabling RLS or restoring broad grants. Roll back application code or use a forward corrective migration.
- High-risk auth/RLS changes use a canary tenant, staged migration, feature flag only for non-security behavior, and explicit rollback criteria.
- Secret rotation supports overlapping credentials only for the minimum controlled window, then revokes the old credential.
- Security gates remain blocking; a failing gate cannot be bypassed by an environment variable.

## 8. Non-goals and explicit limitations

- This design does not certify HIPAA, SOC 2, GDPR, or any other legal/compliance regime. It creates technical controls and evidence needed for qualified review.
- It does not make self-hosted Supabase automatically HIPAA compliant; BAAs, legal controls, operational procedures, and infrastructure safeguards remain required.
- It does not use prompt instructions as a substitute for authorization, testing, or deployment controls.
- It does not expose or reproduce existing credentials, PHI, or private customer data in documentation, tests, or telemetry.

## 9. Spec self-review

- **Scope:** The design is intentionally large because the user selected a combined HIPAA/ePHI and enterprise program. It decomposes into four independently releasable phases with explicit gates.
- **Evidence separation:** Source-confirmed repository findings are distinguished from deployment-dependent risks and external research. No secret values are included.
- **Consistency:** The same invariants are carried through identity, RLS, API, AI, mobile, CI/CD, and compliance sections. Service-role and platform-admin boundaries are consistent.
- **Ambiguity:** The required control behavior, phase order, release gates, and evidence expectations are explicit. Vendor-specific implementation choices are constrained by approved BAA/eligibility review rather than guessed.
- **No placeholders:** The document contains no implementation TODO/TBD markers. Future work is expressed as gated phases and concrete acceptance evidence.
