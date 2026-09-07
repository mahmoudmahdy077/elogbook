# Runbook: Incident response + key rotation

## Incident (suspected breach, outage, or policy violation)

1. Contain: fence writers (stop app / maintenance mode); snapshot logs
   BEFORE rotating anything (evidence first).
2. Assess: which tenants/records/keys are in scope; pull the audit trail
   (`audit_logs` by actor/tenant/action/time window).
3. Service-role key suspected? Rotate immediately (below), then revoke
   sessions: affected users re-authenticate (AAL2 for operators).
4. Tenant-scoped incident? Suspend the tenant (platform console →
   tenant status; direct APIs deny suspended tenants via guards) and
   export its data only through the controlled recovery path.
5. Notify per the breach-notification decision tree (legal owns the
   tree; this runbook does not define notification law).
6. Post-incident: root cause, which gate missed it (add a regression),
   drill report filed.

## Key rotation

| Key | Rotate by |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → new key → update server env → restart app → verify readiness → revoke old |
| `APP_ENCRYPTION_KEY` / salts | Escrow ceremony required (T07-full owner decision); rotation without re-encryption plan is data loss |
| Bootstrap/manager credentials | Regenerate locally on the host; old verifiers die with the record |
| Webhook/AI provider secrets | Provider dashboard → tenant integration settings → verify delivery |

After any rotation: readiness 200, login + RLS spot checks, backup run,
incident log entry. Automated rotation/escrow arrives with T07-full;
until then rotation is a checklist, not a button.
