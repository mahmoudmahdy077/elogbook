# Incident Runbooks (P3.4)

## Security Event

1. Identify affected resources, scope, and data classification
2. Preserve evidence: logs, audit trail, database snapshots
3. Revoke compromised credentials/tokens immediately
4. Notify security officer and data protection officer
5. Contain: disable affected user/tenant/integration
6. Document: timeline, impact, remediation steps
7. Postmortem within 72 hours

## Data Corruption

1. Identify scope: single record, table, or entire database
2. Use PITR to restore affected data to a point before corruption
3. Verify restored data integrity with row counts and checksums
4. Replay audit log from affected period to identify cause
5. Apply compensating controls to prevent recurrence

## Failed Deployment

1. Revert to previous Vercel deployment via Vercel dashboard
2. If database migration was included, run rollback SQL from `supabase/rollbacks/`
3. Verify application health via `/api/health`
4. Notify affected users if downtime exceeded SLO
5. Create incident ticket and schedule postmortem

## Availability Outage

1. Check Vercel status dashboard and Supabase status page
2. Verify DNS resolution and certificate validity
3. Check recent deployments for breaking changes
4. If Vercel/Supabase issue: wait for provider resolution
5. If application issue: rollback deployment
6. If database issue: failover/restore from PITR

## Vendor Outage (Supabase/Vercel)

1. Confirm on provider status page
2. Switch to read-only mode if available
3. Extend API timeout/retry windows
4. Keep users informed via status page banner
5. Document workarounds and limitations

## Mistaken Export

1. Identify affected records and export format
2. Determine if export was received by unauthorized party
3. If PHI involved: follow breach notification protocol
4. Revoke export file signed URLs
5. Audit the export event in audit_logs

## Mobile Sync Duplication

1. Identify duplicate case entries from sync log
2. Soft-delete duplicates, preserving originals
3. Verify no data loss or patient record duplication
4. Sync diagnostic report from device
5. Apply fix in next mobile build
