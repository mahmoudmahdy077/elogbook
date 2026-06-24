# Migration Rollback Plan

> **Purpose**: Phased rollback instructions for each migration in reverse order.
> **Applies to**: Migrations 00019–00025 (enterprise hardening)
> **Always test rollback on staging before production.**

---

## Rollback Order (reverse of apply)

Apply migrations forward: `00019 → 00020 → ... → 00025`
Rollback: `00025 → 00024 → ... → 00019`

---

### 00025: BRIN Indexes + PHI Check Constraint

**Changes**:
- BRIN indexes on `audit_logs(created_at)`, `ai_query_logs(created_at)`, `ai_response_cache(expires_at)`, `case_entries(created_at)`
- B-tree index on `ai_response_cache(expires_at)` for cleanup function
- PHI check constraint: `deidentified_no_phi` on `case_entries`

**Rollback SQL**:
```sql
DROP INDEX IF EXISTS idx_audit_logs_created_at_brin;
DROP INDEX IF EXISTS idx_ai_query_logs_created_at_brin;
DROP INDEX IF EXISTS idx_ai_response_cache_expires_at_brin;
DROP INDEX IF EXISTS idx_case_entries_created_at_brin;
DROP INDEX IF EXISTS idx_ai_response_cache_expires_at;
ALTER TABLE case_entries DROP CONSTRAINT IF EXISTS deidentified_no_phi;
```

**Data safety**: No data loss. Indexes can be recreated. Constraint removal may allow PHI-leaking inserts.

---

### 00024: Add AI Quota Tracking

**Changes**:
- Add `quota_used` column to `resident_ai_toggle` (DEFAULT 0, NOT NULL)
- Add `quota_used_non_negative` CHECK constraint

**Rollback SQL**:
```sql
ALTER TABLE resident_ai_toggle DROP CONSTRAINT IF EXISTS quota_used_non_negative;
ALTER TABLE resident_ai_toggle DROP COLUMN IF EXISTS quota_used;
```

**Data safety**: The `quota_used` values are lost. AI quota enforcement stops working until column is re-added. If the edge function has been updated to use atomic UPDATE (T-009), it will fail when the column is missing. The function must be rolled back first OR handle missing column gracefully.

---

### 00023: Allow Rejected→Draft Resubmit

**Changes**:
- Rewrite `write_once_submitted_check` to allow `rejected → draft` transitions for residents
- Blocks other modifications to non-draft entries

**Rollback SQL**:
```sql
CREATE OR REPLACE FUNCTION write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_user_role();
  IF v_role = 'resident' AND OLD.status != 'draft' THEN
    RAISE EXCEPTION 'Cannot modify a submitted case.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
```

**Data safety**: No data loss. Rollback restores the original blocking behavior — residents will not be able to resubmit rejected cases until the migration is re-applied.

---

### 00022: Subscriptions Tenant Unique Constraint

**Changes**:
- Add `UNIQUE(tenant_id)` constraint on `subscriptions`
- Add index on `subscriptions(gateway_subscription_id)`

**Rollback SQL**:
```sql
DROP INDEX IF EXISTS idx_subscriptions_gateway_id;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_key;
```

**Data safety**: No data loss. The webhook's `onConflict: 'tenant_id'` will fail on subsequent calls until the constraint is re-added. If duplicate `tenant_id` rows exist before rollback, they must be deduplicated first.

**Check before rollback**:
```sql
SELECT tenant_id, COUNT(*) FROM subscriptions GROUP BY tenant_id HAVING COUNT(*) > 1;
```
If duplicates exist, resolve by keeping the latest record per tenant before dropping the constraint.

---

### 00021: Create stripe_events Table

**Changes**:
- Create `stripe_events` table with `stripe_event_id UNIQUE` for webhook idempotency
- Add service-role-only RLS policy

**Rollback SQL**:
```sql
DROP TABLE IF EXISTS stripe_events;
```

**Data safety**: ALL stripe event records are lost. Webhook idempotency stops working. Webhook events will be reprocessed on next occurrence. Only rollback if the table hasn't processed critical events.

**Check before rollback**:
```sql
SELECT COUNT(*) FROM stripe_events WHERE status = 'processing';
```
If any events are still processing, wait for completion before rollback.

---

### 00020: Secure SECURITY DEFINER search_path

**Changes**:
- Adds `SET search_path = ''` to all 18 SECURITY DEFINER functions
- Changes `hash_patient_mrn` volatility from `IMMUTABLE` → `STABLE`

**Rollback SQL**: Revert each function to its previous definition (without `SET search_path = ''`). For `hash_patient_mrn`, change back to `IMMUTABLE`.

**IMPORTANT**: Rolling back removes schema injection protection. Only rollback temporarily for debugging.

**Data safety**: No data loss. Functions revert to previous behavior but lose search_path hardening (schema hijacking risk).

---

### 00019: Fix Consent Records RLS

**Changes**:
- Fix `consent_records` RLS policy — change `p.id = auth.uid()` → `p.user_id = auth.uid()`

**Rollback SQL**:
```sql
DROP POLICY IF EXISTS "Admin can read all tenant consent records" ON consent_records;
CREATE POLICY "Admin can read all tenant consent records" ON consent_records
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.tenant_id = consent_records.tenant_id
        AND p.id = auth.uid()
        AND p.role IN ('institution_admin', 'admin')
    )
  );
```

**Data safety**: No data loss. Rollback restores the broken RLS — admins will no longer be able to query consent records correctly.

---

## Emergency Rollback Procedure

If a migration causes production issues:

1. **Stop the app** or set maintenance mode
2. **Run rollback SQL** for the offending migration (single step)
3. **Redeploy edge functions** if the migration changed function signatures (00020, 00023)
4. **Verify** the app works before rolling back any further
5. **File a bug** and create a fix migration

## Testing Rollback

```bash
# 1. Apply all migrations
supabase db push

# 2. Run rollback SQL for the specific migration (in psql or Supabase SQL editor)
# 3. Verify the schema is in the expected state
# 4. Re-apply the migration to restore
supabase db push
```
