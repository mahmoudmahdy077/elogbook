# Mobile threat model (M0)

**Date:** 2026-09-09 · **Owner:** security · **Status:** wired (review + sign-off still required for residual risks).

Qualified release scope: online-capable case capture with a local durable
retry queue; server authoritative for policy, identity, and clinical truth.
Full-offline identifiable records are explicitly NOT promised (see ADR-002).

## Attacker / risk records

### 1. Stolen / lost device
- **Blast radius:** local drafts, queued payloads, cached rows, screenshots, notifications, backups.
- **Controls:** field-level AEAD envelopes (no plaintext PHI at rest in new stores); SecureStore device key; biometric gate; screenshot guard; redacted notifications; scoped keys per account.
- **Residual risk:** device key is per-install, not per-account; an unlocked rooted device with keystore extraction can decrypt local envelopes. OS backup may carry app data.
- **Incident owner:** security. Requires artifact proof of backup/restore behavior + owner acceptance of device-loss data exposure.

### 2. Malicious resident (authenticated user)
- **Blast radius:** own tenant rows; attempts to read/modify other tenants, escalate role, submit identifiable records when tenant is de-identified-only.
- **Controls:** RLS deny-by-default; server capability snapshot (never client role strings); data-mode enforced on insert/update/export/sync/edge; idempotent op keys prevent duplicate-approval gaming; audit rows.
- **Residual risk:** client can be tampered (repackaged); server must reject everything the client should not do.
- **Incident owner:** platform.

### 3. Insider administrator (tenant admin)
- **Blast radius:** tenant policy (data mode choice), tenant users, tenant rows, exports.
- **Controls:** tenant choice capped by super-admin/install ceiling; platform-admin boundary proven by live-schema tests, not grep; exports audited; suspension propagates to capability refresh.
- **Residual risk:** malicious admin exfiltrates tenant data they legitimately administer — a hiring/trust problem, mitigated by audit + least privilege.
- **Incident owner:** platform.

### 4. Compromised account (credential theft)
- **Blast radius:** victim's tenant access until revocation.
- **Controls:** expiry + refresh, suspension status in capability, MFA step-up for sensitive actions, sign-out disposal (workers stopped, memory cleared, draft wiped, push identity rotated), per-account scoping so a second user on the device cannot read the first user's scope.
- **Residual risk:** refresh-token window before revocation propagates.
- **Incident owner:** security.

### 5. Network attacker (MITM / hostile Wi-Fi)
- **Blast radius:** API traffic, attachments, push payloads.
- **Controls:** TLS-only (no cleartext), certificate-pinned endpoints where configured, signed URLs with short expiry for storage, no tokens/URLs in logs or notifications, idempotent retries safe under duplicate delivery.
- **Residual risk:** hostile captive portals cause denial of service only; queue holds work locally until connectivity returns.
- **Incident owner:** security.

### 6. Malicious update (compromised build / rollback attack)
- **Blast radius:** all client-side guarantees.
- **Controls:** pinned EAS/Expo/Node/pnpm versions, frozen lockfile, SBOM, provenance attestation, cert fingerprint recorded per release, runtime-version policy, staged rollout with kill switch and rollback, upgrade-compat tests from two prior versions.
- **Residual risk:** store review lag; staged rollout + kill switch bound the blast radius.
- **Incident owner:** release.

### 7. Backend operator (VPS / database access)
- **Blast radius:** server rows, backups, secrets, published content.
- **Controls:** setup control plane absent in production builds; setup-mode routes require bootstrap boundary + one-time token + origin/CSRF + rate limits + serialized jobs + least-privilege executor + audit; encrypted off-host backups; transactional publication with in-DB authorization; RLS deny-by-default with fresh+upgrade replay proof.
- **Residual risk:** operator with host root can read server-side plaintext by design (server is authoritative, not zero-knowledge).
- **Incident owner:** platform.
