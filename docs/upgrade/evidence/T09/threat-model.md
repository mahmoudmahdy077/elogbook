# T09 Threat Model — Isolated host manager (`apps/ops`)

Status: PROPOSED architecture + bounded implemented substep (bootstrap
claim). Independent security review checkpoint REQUIRED before T10
executor work (adjudication amendment). This document does not authorize
host operations.

## 1. Boundaries and trust

```
[browser] --HTTPS--> [Caddy] --> [web: nextjs, unprivileged]
[web] --Unix socket, credential+op envelope--> [ops manager: root-adjacent]
[ops] --Docker socket, local journal--> [host/Docker/Supabase stack]
[owner] --SSH/cloud-init--> [launcher] --> [ops bootstrap]
```

- `apps/web` NEVER holds: Docker socket, host shell, installation
  secrets, manager signing keys. Enforced by Gate H boundary rule
  (`scripts/verify-exports.mjs` fails any `@elogbook/ops` import from
  app artifacts).
- `apps/ops` NEVER accepts: arbitrary commands/paths/Compose/SQL/image
  repos/shell fragments, caller-supplied role fields, client-supplied
  release URLs (T13).
- Private networks are transport, not authorization. Every manager call
  validates: short-lived operator credential + verified AAL2 + current
  platform authority + installation ID + exact operation + release
  digest + idempotency key (T10).

## 2. Assets and impact

| Asset | Loss | Priority |
|---|---|---|
| Postgres application/auth/storage data | PHI breach, training records | Highest |
| Object bytes + encryption keys | Unrecoverable loss / breach | Highest |
| Installation/bootstrap ownership | Hostile takeover of host | Highest |
| Release manifests/signatures | Malicious update | High |
| Backup sets in transit/at rest | Breach | High |
| Audit journal | Cover-up of misuse | High |

## 3. Threat matrix (initial; T10 extends per-operation)

| # | Threat | Mitigation (state) |
|---|---|---|
| T9.1 | Unauthenticated bootstrap claim from network | Localhost/SSH-tunnel default; one-time expiring token; IMPLEMENTED (claim core, this batch) |
| T9.2 | Token replay / concurrent claim | Single-use verifier; second claim fails `used`; concurrent-claim fencing in T10 journal |
| T9.3 | Token brute force | 5-attempt lockout (15 min), persisted in record; throttling survives restart once journaled (T10) |
| T9.4 | Restart reopens bootstrap | Closure is a persisted state transition; reboot reads journal first (T10); unit-covered `usedAt` semantics now |
| T9.5 | Web compromise → host shell | No socket/executor imports in web (gate-enforced); Unix-socket transport with per-call auth (T10) |
| T9.6 | Stale worker continues after takeover | Fencing tokens, single writer (T10) |
| T9.7 | Manager self-destruct during update | Separate manager bundle + recovery path (T11/T14); never destroy own recovery |
| T9.8 | Claim oracle (expiry vs invalid distinguishability) | Reasons server-side only; generic claimant denial (implemented) |

## 4. Key/token lifecycle (outline; owner decisions pending)

- Bootstrap token: 256-bit, single-use, 30-min TTL, verifier-only storage.
  Regeneration is a LOCAL owner action (never remote).
- Operator sessions: short-lived, HttpOnly, origin/CSRF-bound (T10).
- Release signing identity + rotation: T13. Backup encryption keys +
  escrow: T07 owner decisions. No key material in this substep.

## 5. Deployment model

- First topology only: Ubuntu 24.04 x86_64, pinned Docker/Compose (T11).
- Manager runs outside app/Supabase lifecycle; journal on host disk
  (SQLite, single writer), independent of the Supabase it updates.
- Caddy remains the only ingress; ops endpoints never published.

## 6. Failure/chaos starter (T10 expands per transition)

Killed manager mid-claim, reboot between claim and setup, expired token
claim, replayed claim, wrong installation ID, 5× wrong guesses then
correct token (must stay locked), concurrent double-claim (T10 journal
test), disk-full journal write (must fail closed, T10).

## 7. Review checkpoint

T10 executor/HTTP work starts ONLY after owner + security review of this
model signs off. Record sign-off in `docs/upgrade/evidence/T10/`.
