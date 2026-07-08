# E-Logbook Supabase Database Documentation

> Generated from all 73 migration files, 9 edge functions, config.toml, seed.sql, and 4 test files.
> Migration range: 00001–00076 (with gaps 00032–00047 removed during renumbering; ~14 timestamp-named duplicates exist).

---

## 1. TABLES

### 1.1 `institutions`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| name | TEXT | NOT NULL | |
| slug | TEXT | NOT NULL, UNIQUE | |
| settings | JSONB | | `'{}'` |
| tier | TEXT | CHECK (IN `'free','premium','enterprise'`) | `'free'` |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:** PK on id, UNIQUE on slug  
**RLS:** ENABLE + FORCE; SELECT: all authenticated; INSERT/UPDATE/DELETE: admin only  
**Triggers:** `set_updated_at` (BEFORE UPDATE)

### 1.2 `tenants`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| institution_id | UUID | FK → institutions(id) ON DELETE SET NULL | |
| name | TEXT | NOT NULL | |
| slug | TEXT | NOT NULL, UNIQUE | |
| tenant_type | TEXT | NOT NULL, CHECK (IN `'individual'`,`'institution'`) | `'institution'` |
| plan_id | UUID | | |
| settings | JSONB | | `'{}'` |
| region | TEXT | NOT NULL | `'us-east-1'` |
| data_retention_days | INTEGER | | `2555` |
| consent_required | BOOLEAN | | `true` |
| compliance_frameworks | TEXT[] | | `'{}'` |
| mrn_hash_salt | TEXT | NOT NULL | |
| salt_version | INT | NOT NULL DEFAULT 1 | |
| deleted_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:** PK, UNIQUE(slug)  
**RLS:** ENABLE + FORCE; SELECT: own tenant or admin; ALL: admin  
**Triggers:** `set_updated_at` (BEFORE UPDATE, from 00001)

### 1.3 `profiles`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| user_id | UUID | NOT NULL, UNIQUE, FK → auth.users(id) ON DELETE CASCADE | |
| role | TEXT | NOT NULL, CHECK (IN `'resident'`,`'supervisor'`,`'director'`,`'institution_admin'`,`'admin'`) | |
| full_name | TEXT | NOT NULL | |
| specialty | TEXT | | |
| onboarding_completed | BOOLEAN | DEFAULT FALSE | |
| deleted_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- PK on id, UNIQUE(user_id)
- `idx_profiles_tenant_role` ON (tenant_id, role)
- `idx_profiles_tenant_active_resident` ON (tenant_id) WHERE role='resident' AND deleted_at IS NULL

**RLS:** ENABLE + FORCE  
SELECT: own profile, OR supervisor+ for tenant profiles  
INSERT: `user_id = auth.uid() AND tenant_id = get_tenant_id() AND role IN ('resident','supervisor')`  
UPDATE: own profile, OR supervisor+ for residents in tenant  
DELETE: institution_admin/admin only  

**Triggers:**
- `set_updated_at` (BEFORE UPDATE)
- `trg_audit_profile` (AFTER UPDATE — logs role/tenant_id changes via `audit_profile_changes()`)

### 1.4 `case_templates`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| specialty | TEXT | NOT NULL | |
| name | TEXT | NOT NULL | |
| fields | JSONB | NOT NULL | |
| required_fields | JSONB | | `'[]'` |
| created_by | UUID | | |
| deleted_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:** PK  
**RLS:** ENABLE + FORCE; SELECT: same tenant; INSERT/UPDATE/DELETE: director+  
**Triggers:**
- `trg_audit_case_templates` (AFTER INSERT/UPDATE/DELETE via `audit_case_templates()`)
- `trg_audit_case_templates` (from 00056 loop — generic `audit_table_change()`)

### 1.5 `case_entries`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE RESTRICT | |
| template_id | UUID | NOT NULL, FK → case_templates(id) ON DELETE RESTRICT | |
| patient_mrn | TEXT | NULLABLE (was NOT NULL, dropped in 00007) | |
| patient_dob | DATE | NULLABLE (was NOT NULL, dropped in 00007) | |
| case_date | DATE | NOT NULL | `CURRENT_DATE` |
| field_values | JSONB | | `'{}'` |
| status | TEXT | NOT NULL, CHECK (IN `'draft'`,`'pending'`,`'approved'`,`'rejected'`) | `'draft'` |
| is_deidentified | BOOLEAN | | `TRUE` |
| patient_age_years | INTEGER | | |
| patient_hash | TEXT | | |
| accreditation_mappings | JSONB | | `'[]'` |
| deleted_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**CHECK Constraint:** `deidentified_no_phi` — `NOT is_deidentified OR (patient_mrn IS NULL AND patient_dob IS NULL)`

**Indexes (comprehensive):**
- PK on id
- `idx_case_entries_tenant` (tenant_id)
- `idx_case_entries_resident` (resident_id)
- `idx_case_entries_status` (status)
- `idx_case_entries_field_values` GIN (field_values)
- `idx_case_entries_tenant_status` (tenant_id, status)
- `idx_case_entries_tenant_resident_status` (tenant_id, resident_id, status)
- `idx_case_entries_case_date` (case_date)
- `idx_case_entries_tenant_patient_hash` (tenant_id, patient_hash)
- `idx_case_entries_created_at_brin` BRIN (created_at)
- `idx_case_entries_resident_status` (resident_id, status) WHERE deleted_at IS NULL
- `idx_case_entries_tenant_resident_created` (tenant_id, resident_id, created_at DESC, id DESC) WHERE deleted_at IS NULL
- `idx_case_entries_tenant_status_created` (tenant_id, status, created_at DESC) WHERE deleted_at IS NULL
- `idx_case_entries_tenant_status_active` (tenant_id, status) WHERE deleted_at IS NULL

**RLS:** ENABLE + FORCE  
SELECT: own entries, OR supervisor+ all tenant entries (both filtered WHERE deleted_at IS NULL)  
INSERT: tenant_id match, resident_id own profile  
UPDATE (resident): own draft/rejected → only to draft  
UPDATE (supervisor+): pending → approved/rejected  
Additional policy: `no_inserts_for_lapsed_tenants` blocks INSERT when subscription is past_due/unpaid

**Triggers (on this table):**
- `trg_audit_case_entry` (AFTER INSERT/UPDATE/DELETE — PHI-stripped auditing via `audit_case_entry()`)
- `trg_auto_approve_individual` (BEFORE INSERT/UPDATE — auto-sets status='approved' for individual tenants)
- `trg_update_goal_progress` (AFTER INSERT/UPDATE/DELETE — recalculate goal_progress via `recalc_goal_progress()`)
- `trg_write_once_submitted_check` (BEFORE UPDATE — blocks changes to non-draft entries; allows rejected→draft)
- `trg_enforce_case_status_transition` (BEFORE UPDATE — enforces: draft→pending, pending→approved/rejected, approved=immutable, rejected→draft)
- `trg_block_lapsed_tenant_submit` (BEFORE INSERT — blocks case submission for lapsed institutional subscriptions)

### 1.6 `case_attachments`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| entry_id | UUID | NOT NULL, FK → case_entries(id) ON DELETE CASCADE | |
| file_path | TEXT | NOT NULL | |
| file_type | TEXT | NOT NULL | |
| file_name | TEXT | | |
| file_size | INTEGER | | |
| uploaded_by | UUID | FK → profiles(id) | |
| tenant_id | UUID | NOT NULL, FK → tenants(id) | |
| uploaded_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_case_attachments_entry_id` (entry_id)
- `idx_case_attachments_tenant` (tenant_id)

**RLS:** ENABLE + FORCE  
SELECT: same tenant  
INSERT: same tenant + own entry  
DELETE: supervisor+ in tenant  

### 1.7 `approval_requests`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| entry_id | UUID | NOT NULL, FK → case_entries(id) ON DELETE CASCADE | |
| supervisor_id | UUID | FK → profiles(id) ON DELETE SET NULL | |
| tenant_id | UUID | NOT NULL, FK → tenants(id) | |
| status | TEXT | NOT NULL, CHECK (IN `'pending'`,`'approved'`,`'rejected'`) | `'pending'` |
| comment | TEXT | | |
| requested_at | TIMESTAMPTZ | | `NOW()` |
| resolved_at | TIMESTAMPTZ | | |

**Constraints:** `approval_requests_entry_supervisor_unique` UNIQUE(entry_id, supervisor_id)

**Indexes:**
- `idx_approval_requests_supervisor_status` (supervisor_id, status) WHERE supervisor_id IS NOT NULL
- `idx_approval_requests_entry_id` (entry_id)
- `idx_approval_requests_tenant` (tenant_id)

**RLS:** ENABLE + FORCE  
SELECT: same tenant  
INSERT: same tenant + own entry  
UPDATE: supervisor+ in tenant  

### 1.8 `audit_logs`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| user_id | UUID | FK → auth.users(id) ON DELETE SET NULL | |
| action | TEXT | NOT NULL | |
| resource_type | TEXT | NOT NULL | |
| resource_id | UUID | NOT NULL | |
| changes | JSONB | | |
| ip_address | TEXT | | |
| metadata | JSONB | | (added by some later functions) |
| created_at | TIMESTAMPTZ | | `NOW()` |

**APPEND-ONLY** — UPDATE/DELETE revoked from PUBLIC, anon, authenticated, AND service_role.  
Triggers `trg_reject_audit_update` and `trg_reject_audit_delete` raise exceptions.

**Indexes:**
- `idx_audit_logs_tenant` (tenant_id)
- `idx_audit_logs_resource` (resource_type, resource_id)
- `idx_audit_logs_user_id` (user_id)
- `idx_audit_logs_created_at` (created_at)
- `idx_audit_logs_created_at_brin` BRIN (created_at)
- `idx_audit_logs_user_tenant` (user_id, tenant_id) WHERE user_id IS NOT NULL
- `idx_audit_logs_tenant_created` (tenant_id, created_at DESC)

**RLS:** ENABLE + FORCE  
INSERT: blocked via RLS (only triggers and service_role write)  
SELECT: director+ all tenant logs; supervisors all tenant logs; residents own logs; supervisors case_entries logs  

### 1.9 `program_goals`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| director_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| title | TEXT | NOT NULL | |
| target_count | INTEGER | NOT NULL, CHECK (> 0) | |
| specialty | TEXT | | |
| deadline | DATE | NOT NULL | |
| description | TEXT | | |
| deleted_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- PK on id
- `idx_program_goals_tenant_resident` (tenant_id, resident_id)
- `idx_program_goals_director` (director_id)

**RLS:** ENABLE + FORCE; SELECT: same tenant; INSERT/UPDATE/DELETE: director+  
**Triggers:**
- `set_program_goals_updated_at` (BEFORE UPDATE — `set_program_goals_updated_at()`)
- `trg_audit_program_goals` (AFTER INSERT/UPDATE/DELETE via `audit_program_goals()`)
- `trg_audit_program_goals` (from 00056 loop — generic `audit_table_change()`)

### 1.10 `goal_progress`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| goal_id | UUID | NOT NULL, UNIQUE, FK → program_goals(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| current_count | INTEGER | | `0` |
| last_updated | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- PK on id, UNIQUE(goal_id)
- `idx_goal_progress_resident` (resident_id)

**RLS:** ENABLE + FORCE  
SELECT: tenant members (via goal_id → program_goals → tenant_id)  
INSERT/UPDATE: director+

### 1.11 `subscription_plans`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| name | TEXT | NOT NULL | |
| slug | TEXT | NOT NULL, UNIQUE | |
| price_monthly | NUMERIC(10,2) | NOT NULL | |
| features | JSONB | | `'{}'` |
| tenant_type | TEXT | NOT NULL, CHECK (IN `'individual'`,`'institution'`) | |
| max_residents | INTEGER | | |
| stripe_price_id | TEXT | | |
| storage_quota_mb | INTEGER | NOT NULL, CHECK (> 0) | `1024` |
| created_at | TIMESTAMPTZ | | `NOW()` |

**RLS:** ENABLE + FORCE; SELECT: all authenticated; ALL: admin

### 1.12 `subscriptions`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| plan_id | UUID | NOT NULL, FK → subscription_plans(id) | |
| status | TEXT | NOT NULL, CHECK (IN `'active'`,`'canceled'`,`'past_due'`,`'unpaid'`,`'trialing'`) | `'active'` |
| gateway_subscription_id | TEXT | | |
| current_period_start | TIMESTAMPTZ | | |
| current_period_end | TIMESTAMPTZ | | |
| stripe_customer_id | TEXT | CHECK (format: 24-char hex OR `cus_` prefix) | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Constraints:** UNIQUE(tenant_id, status) — partial, WHERE status IN ('active','trialing','past_due').  
The full UNIQUE(tenant_id) constraint was added in 00022 then dropped in 00055.

**Indexes:**
- `idx_subscriptions_tenant_status` (tenant_id, status)
- `idx_subscriptions_gateway_subscription_id` (gateway_subscription_id)
- `idx_subscriptions_gateway_id` (gateway_subscription_id) — duplicate
- `idx_subscriptions_tenant_active_unique` UNIQUE (tenant_id) WHERE status IN ('active','trialing','past_due')
- `idx_subscriptions_tenant_created` (tenant_id, created_at DESC)

**RLS:** ENABLE + FORCE; SELECT: same tenant; ALL: institution_admin/admin

### 1.13 `payments`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| amount | NUMERIC(10,2) | NOT NULL | |
| currency | TEXT | | `'usd'` |
| gateway_payment_intent_id | TEXT | | |
| stripe_event_id | TEXT | UNIQUE | |
| status | TEXT | NOT NULL, CHECK (IN `'pending'`,`'completed'`,`'failed'`,`'refunded'`,`'cancelled'`) | `'pending'` |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_payments_tenant_id` (tenant_id)
- `idx_payments_gateway_payment_intent_id` (gateway_payment_intent_id)

**RLS:** ENABLE + FORCE; SELECT: same tenant; ALL: institution_admin/admin

### 1.14 `one_time_purchases`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| tenant_id | UUID | NOT NULL, FK → tenants(id) | |
| purchase_type | TEXT | NOT NULL | |
| amount | NUMERIC(10,2) | NOT NULL | |
| gateway_payment_intent_id | TEXT | | |
| status | TEXT | CHECK (IN `'pending'`,`'completed'`,`'failed'`,`'refunded'`) | `'pending'` |
| consumed | BOOLEAN | | `FALSE` |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_one_time_purchases_resident` (resident_id)
- `idx_one_time_purchases_tenant` (tenant_id)

**RLS:** ENABLE + FORCE  
SELECT: own purchases, OR supervisor+ tenant purchases  
INSERT: own profile + same tenant  
UPDATE: institution_admin/admin

### 1.15 `ai_config`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, UNIQUE, FK → tenants(id) ON DELETE CASCADE | |
| provider | TEXT | NOT NULL, CHECK (IN `'openai'`,`'anthropic'`,`'azure'`,`'openrouter'`,`'custom'`) | |
| model | TEXT | NOT NULL | |
| api_key_enc | BYTEA | (encrypted via pgp_sym_encrypt) | |
| encrypted_api_key | TEXT | **DROPPED** in 00053 | |
| key_version | INT | NOT NULL | `1` |
| endpoint_url | TEXT | | |
| is_active | BOOLEAN | | `FALSE` |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- PK + UNIQUE(tenant_id)
- `idx_ai_config_tenant_active` (tenant_id) WHERE is_active=true

**RLS:** ENABLE + FORCE  
Direct table SELECT revoked from authenticated/anon. Access via `secret_ai_config` view only.  
RLS policy on table: institution_admin+ only.  

**Triggers:**
- `trg_audit_ai_config` (AFTER INSERT/UPDATE/DELETE via `audit_config_change()` — redacts secrets)

### 1.16 `resident_ai_toggle`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| enabled | BOOLEAN | | `FALSE` |
| quota_limit | INTEGER | | `50` |
| quota_used | INTEGER | NOT NULL, CHECK (>= 0) | `0` |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Constraints:** UNIQUE(tenant_id, resident_id), quota_used_non_negative CHECK (quota_used >= 0)

**Indexes:**
- `idx_resident_ai_toggle_tenant` (tenant_id)

**RLS:** ENABLE + FORCE  
SELECT: same tenant + own profile OR supervisor+  
ALL: institution_admin+  
UPDATE direct: REVOKEd from authenticated (only `consume_ai_quota` / `grant_ai_quota` RPCs can mutate)

### 1.17 `ai_query_logs`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| query | TEXT | NOT NULL | |
| response | TEXT | | |
| tokens_used | INTEGER | CHECK (>= 0) | |
| disclaimer_rendered | BOOLEAN | | `false` |
| response_format | TEXT | CHECK (IN `'text'`,`'stream'`) | `'text'` |
| safety_flags | TEXT[] | | `'{}'` |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_ai_query_logs_resident_date` (resident_id, created_at DESC) WHERE resident_id IS NOT NULL
- `idx_ai_query_logs_created_at_brin` BRIN (created_at)
- `idx_ai_query_logs_tenant_resident` (tenant_id, resident_id)
- `idx_ai_query_logs_created_at` (created_at)
- `idx_ai_query_logs_tenant_created` (tenant_id, created_at DESC)

**RLS:** ENABLE + FORCE  
SELECT: own logs, OR supervisor+ all tenant logs  
INSERT: same tenant + (own profile OR supervisor+)

### 1.18 `payment_gateway_config`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, UNIQUE, FK → tenants(id) ON DELETE CASCADE | |
| provider | TEXT | NOT NULL, CHECK (IN `'stripe'`,`'paddle'`,`'lemonsqueezy'`,`'custom'`) | |
| publishable_key | TEXT | NOT NULL | |
| secret_key_enc | BYTEA | (encrypted via pgp_sym_encrypt) | |
| webhook_secret_enc | BYTEA | (encrypted via pgp_sym_encrypt) | |
| encrypted_secret_key | TEXT | **DROPPED** in 00053 | |
| encrypted_webhook_secret | TEXT | **DROPPED** in 00053 | |
| key_version | INT | NOT NULL | `1` |
| mode | TEXT | NOT NULL, CHECK (IN `'test'`,`'live'`) | `'test'` |
| endpoint_url | TEXT | | |
| is_active | BOOLEAN | | `FALSE` |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- PK + UNIQUE(tenant_id)
- `idx_payment_gateway_config_tenant_active` (tenant_id) WHERE is_active=true

**RLS:** ENABLE + FORCE  
Direct table SELECT revoked from authenticated/anon. Access via `secret_payment_gateway_config` view only.  
RLS policy on table: institution_admin+ only.  

**Triggers:**
- `trg_audit_payment_gateway` (AFTER INSERT/UPDATE/DELETE via `audit_config_change()` — redacts secrets)

### 1.19 `accreditation_frameworks`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| name | TEXT | NOT NULL | |
| version | TEXT | NOT NULL | `'1.0'` |
| framework_type | TEXT | NOT NULL, CHECK (IN `'acgme'`,`'scfhs'`,`'gmc'`,`'canmeds'`,`'custom'`) | |
| milestones | JSONB | NOT NULL | `'[]'` |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:** `idx_accreditation_frameworks_tenant` (tenant_id)  
**RLS:** ENABLE + FORCE; SELECT: same tenant; INSERT/UPDATE/DELETE: director+  
**Triggers:** `trg_audit_accreditation_framework` (AFTER INSERT/UPDATE/DELETE via `audit_accreditation_framework()`)

### 1.20 `attachment_signatures`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| attachment_id | UUID | NOT NULL, FK → case_attachments(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| signature_hash | TEXT | NOT NULL | |
| verification_method | TEXT | NOT NULL, CHECK (IN `'camera_hash'`,`'manual_hash'`,`'device_signature'`) | |
| verified_at | TIMESTAMPTZ | | `NOW()` |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_attachment_signatures_tenant` (tenant_id)
- `idx_attachment_signatures_attachment` (attachment_id)

**RLS:** ENABLE + FORCE; SELECT: same tenant; INSERT: own profile

### 1.21 `institution_billing`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| billing_period_start | DATE | NOT NULL | |
| billing_period_end | DATE | NOT NULL | |
| active_residents | INTEGER | NOT NULL | `0` |
| base_amount | NUMERIC(10,2) | NOT NULL | `0` |
| per_resident_fee | NUMERIC(10,2) | NOT NULL | `0` |
| total_amount | NUMERIC(10,2) | NOT NULL | `0` |
| status | TEXT | NOT NULL, CHECK (IN `'draft'`,`'sent'`,`'paid'`,`'overdue'`,`'canceled'`) | `'draft'` |
| invoice_url | TEXT | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Constraints:** UNIQUE(tenant_id, billing_period_start)  
**Indexes:** `idx_institution_billing_tenant` (tenant_id)  
**RLS:** ENABLE + FORCE; SELECT: director+; ALL: institution_admin+  
**Trigger:** `set_updated_at`

### 1.22 `consent_records`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| user_id | UUID | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | |
| consent_type | TEXT | NOT NULL, CHECK (IN `'data_processing'`,`'ai_insights'`,`'data_export'`,`'marketing'`,`'research'`,`'analytics'`,`'data_sharing'`) | |
| granted_at | TIMESTAMPTZ | NOT NULL | `NOW()` |
| revoked_at | TIMESTAMPTZ | | |
| version | TEXT | NOT NULL | `'1.0'` |
| ip_address | TEXT | | |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_consent_records_tenant_user` (tenant_id, user_id)
- `idx_consent_records_type` (consent_type)
- `idx_consent_records_tenant_type_granted` (tenant_id, consent_type, granted_at DESC)

**RLS:** ENABLE + FORCE; SELECT: own records, OR admin+ same tenant; INSERT: own

### 1.23 `ai_response_cache`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| query_hash | TEXT | NOT NULL | |
| query_text | TEXT | NOT NULL | |
| response_text | TEXT | NOT NULL | |
| tokens_used | INTEGER | | |
| model | TEXT | NOT NULL | |
| provider | TEXT | NOT NULL | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| expires_at | TIMESTAMPTZ | NOT NULL | |

**Constraints:** UNIQUE(tenant_id, resident_id, query_hash)

**Indexes:**
- `idx_ai_response_cache_lookup` (tenant_id, resident_id, query_hash)
- `idx_ai_response_cache_expires_at_brin` BRIN (expires_at)
- `idx_ai_response_cache_expires_at` BTREE (expires_at)

**RLS:** ENABLE + FORCE  
SELECT: own responses  
INSERT: own responses  
ALL: service_role

### 1.24 `stripe_events`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| stripe_event_id | TEXT | UNIQUE NOT NULL | |
| event_type | TEXT | NOT NULL | |
| mode | TEXT | | (P6.8: 'test'/'live') |
| livemode | BOOLEAN | | |
| status | TEXT | NOT NULL, CHECK (IN `'received'`,`'processed'`,`'failed'`) | `'received'` |
| failure_reason | TEXT | | |
| tenant_id | UUID | FK → tenants(id) | |
| payload | JSONB | | |
| signature_valid | BOOLEAN | | |
| processed | BOOLEAN | | `FALSE` |
| processed_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_stripe_events_status_failed` (status, created_at) WHERE status='failed'
- UNIQUE(stripe_event_id)

**RLS:** ENABLE + FORCE; ALL: only service_role (via `auth.role() = 'service_role'`)

### 1.25 `tenant_sso_configs`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| protocol | TEXT | NOT NULL, CHECK (IN `'saml'`,`'oidc'`) | |
| metadata_url | TEXT | | |
| discovery_url | TEXT | | |
| idp_entity_id | TEXT | | |
| idp_certificate | TEXT | | |
| client_id | TEXT | | |
| client_secret_encrypted | TEXT | | |
| default_role | TEXT | NOT NULL, CHECK (IN `'resident'`,`'supervisor'`,`'director'`,`'institution_admin'`) | `'resident'` |
| is_active | BOOLEAN | NOT NULL | `true` |
| created_at | TIMESTAMPTZ | NOT NULL | `now()` |
| updated_at | TIMESTAMPTZ | NOT NULL | `now()` |

**Constraints:** UNIQUE(tenant_id, protocol)  
**Indexes:** `idx_tenant_sso_configs_tenant` (tenant_id) WHERE is_active=true  
**RLS:** ENABLE + FORCE  
SELECT: director/institution_admin of tenant OR platform admin  
ALL: platform admin only  
**Trigger:** `tenant_sso_configs_touch` (BEFORE UPDATE — calls `touch_updated_at()` — **NOTE: this function is NOT defined in any migration**)

### 1.26 `tenant_webhooks`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| url | TEXT | NOT NULL, CHECK (`~* '^https?://'`) | |
| events | TEXT[] | NOT NULL, CHECK (cardinality > 0) | |
| secret | TEXT | NOT NULL | |
| secret_enc | BYTEA | (encrypted via pgp_sym_encrypt) | |
| is_active | BOOLEAN | NOT NULL | `true` |
| description | TEXT | | |
| created_at | TIMESTAMPTZ | NOT NULL | `NOW()` |
| updated_at | TIMESTAMPTZ | NOT NULL | `NOW()` |

**Indexes:** `idx_tenant_webhooks_tenant` (tenant_id) WHERE is_active=true  
**RLS:** ENABLE + FORCE; ALL: director/institution_admin of tenant OR platform admin  
**Trigger:** `tenant_webhooks_touch` (BEFORE UPDATE — calls `touch_updated_at()` — **missing function**)  
**View:** `secret_tenant_webhooks` (security_barrier=true) decrypts `secret_enc` for authorized callers

### 1.27 `tenant_webhook_deliveries`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| webhook_id | UUID | NOT NULL, FK → tenant_webhooks(id) ON DELETE CASCADE | |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| event_type | TEXT | NOT NULL | |
| event_id | TEXT | NOT NULL | |
| status_code | INTEGER | | |
| request_body | TEXT | | |
| response_body | TEXT | | |
| attempted_at | TIMESTAMPTZ | NOT NULL | `NOW()` |
| completed_at | TIMESTAMPTZ | | |
| succeeded | BOOLEAN | NOT NULL | `false` |

**Indexes:** `idx_tenant_webhook_deliveries_webhook` (webhook_id, attempted_at DESC)  
**RLS:** ENABLE + FORCE; SELECT: director/institution_admin OR platform admin

### 1.28 `scim_tokens`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| token_hash | TEXT | NOT NULL, UNIQUE | |
| description | TEXT | | |
| created_by | UUID | FK → auth.users(id) | |
| created_at | TIMESTAMPTZ | NOT NULL | `NOW()` |
| last_used_at | TIMESTAMPTZ | | |
| revoked_at | TIMESTAMPTZ | | |

**Indexes:** `idx_scim_tokens_tenant` (tenant_id) WHERE revoked_at IS NULL  
**RLS:** ENABLE + FORCE; ALL: platform admin only

### 1.29 `rate_limits`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| key | TEXT | PK | |
| window_start | TIMESTAMPTZ | NOT NULL | `now()` |
| count | INT | NOT NULL | `0` |

**RLS:** ENABLE + FORCE; ALL revoked from PUBLIC/anon/authenticated; only service_role via SECURITY DEFINER RPC `check_rate_limit()`

### 1.30 `duty_periods`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| shift_date | DATE | NOT NULL | |
| hours_worked | DECIMAL(4,2) | NOT NULL, CHECK (0–24) | |
| shift_type | TEXT | NOT NULL, CHECK (IN `'call'`,`'clinic'`,`'vacation'`,`'weekend'`,`'regular'`) | |
| notes | TEXT | | |
| created_at | TIMESTAMPTZ | | `NOW()` |
| updated_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_duty_periods_tenant_date` (tenant_id, shift_date)
- `idx_duty_periods_resident` (resident_id, shift_date)
- `idx_duty_periods_tenant_resident_shift` (tenant_id, resident_id, shift_date) INCLUDE (hours_worked)

**RLS:** ENABLE; FOR ALL USING/WITH CHECK (tenant_id = caller's tenant via profiles)

### 1.31 `faculty_evaluations`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | UUID | PK | `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL, FK → tenants(id) ON DELETE CASCADE | |
| resident_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| evaluator_id | UUID | NOT NULL, FK → profiles(id) ON DELETE CASCADE | |
| evaluation_date | DATE | NOT NULL | `CURRENT_DATE` |
| clinical_skills | INTEGER | CHECK (1–5) | |
| professionalism | INTEGER | CHECK (1–5) | |
| procedures | INTEGER | CHECK (1–5) | |
| comments | TEXT | | |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Indexes:**
- `idx_faculty_evaluations_resident` (resident_id)
- `idx_faculty_evaluations_tenant` (tenant_id)
- `idx_faculty_evaluations_evaluator` (evaluator_id)
- `idx_faculty_evaluations_tenant_resident` (tenant_id, resident_id)

**RLS:** ENABLE; FOR ALL WITH CHECK: evaluator must be in same tenant as resident

### 1.32 `template_favorites`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| user_id | UUID | PK, NOT NULL, FK → auth.users(id) ON DELETE CASCADE | |
| template_id | UUID | PK, NOT NULL, FK → case_templates(id) ON DELETE CASCADE | |
| created_at | TIMESTAMPTZ | | `NOW()` |

**Primary Key:** (user_id, template_id)  
**Indexes:** `idx_template_favorites_template_id` (template_id)  
**RLS:** ENABLE; SELECT/INSERT/DELETE: own user_id

### 1.33 `scheduled_backup_log`
| Column | Type | Constraints | Default |
|--------|------|-------------|---------|
| id | BIGINT | PK, GENERATED ALWAYS AS IDENTITY | |
| started_at | TIMESTAMPTZ | NOT NULL | `NOW()` |
| completed_at | TIMESTAMPTZ | | |
| status | TEXT | NOT NULL, CHECK (IN `'started'`,`'success'`,`'failed'`) | |
| size_bytes | BIGINT | | |
| notes | TEXT | | |
| created_at | TIMESTAMPTZ | NOT NULL | `NOW()` |

**RLS:** None (intentionally — it's an immutable audit log, access controlled by privileges)

---

## 2. FUNCTIONS / RPCs

### 2.1 Authentication & Tenant Helpers
| Function | Params | Return | Security | search_path |
|----------|--------|--------|----------|-------------|
| `get_tenant_id()` | none | UUID | SECURITY DEFINER, STABLE | `pg_catalog, public` |
| `get_user_role()` | none | TEXT | SECURITY DEFINER, STABLE | `pg_catalog, public` |
| `current_role_in_tenant(tenant_id, roles[])` | (UUID, TEXT[]) | BOOLEAN | *(NOT DEFINED — MISSING FUNCTION)* | — |
| `current_role_global()` | none | TEXT | *(NOT DEFINED — MISSING FUNCTION)* | — |

### 2.2 Approval Functions
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `approve_case(p_entry_id, p_supervisor_id, p_comment)` | UUID, UUID, TEXT DEFAULT NULL | JSONB | SECURITY DEFINER SET search_path = `pg_catalog, public` |
| `reject_case(p_entry_id, p_supervisor_id, p_comment)` | UUID, UUID, TEXT DEFAULT NULL | JSONB | SECURITY DEFINER SET search_path = `pg_catalog, public` |

Both use `SELECT ... FOR UPDATE` (pessimistic lock), verify authorization (supervisor+ role, tenant match), then INSERT/UPDATE approval_requests with correct tenant_id.

### 2.3 Statistics
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `get_case_stats(p_tenant_id, p_resident_id)` | UUID, UUID DEFAULT NULL | JSONB | SECURITY DEFINER STABLE SET search_path = `pg_catalog, public` |
| *(Previous versions existed with different signatures)* | | | |

### 2.4 Encryption Key Functions
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `decrypt_with_version(p_encrypted BYTEA, p_version INT)` | BYTEA, INT | TEXT | STABLE; EXECUTE revoked from PUBLIC/anon/authenticated; only service_role |
| `rotate_encryption_key(p_old_version, p_new_version)` | INT, INT | JSONB | SECURITY DEFINER; service_role only |
| `rotate_mrn_salt(p_tenant_id)` | UUID | JSONB | SECURITY DEFINER; service_role only |

### 2.5 Secret Storage RPCs
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `store_ai_config(p_provider, p_model, p_api_key, p_endpoint_url, p_is_active)` | TEXT, TEXT, TEXT, TEXT, BOOLEAN | JSONB | SECURITY DEFINER; institution_admin+ |
| `store_payment_gateway_secret(p_provider, p_publishable_key, p_secret_key, p_webhook_secret, p_endpoint_url, p_mode)` | TEXT, TEXT, TEXT, TEXT, TEXT, TEXT | JSONB | SECURITY DEFINER; institution_admin+ |
| `store_tenant_webhook(p_url, p_events, p_secret, p_description, p_is_active, p_webhook_id)` | TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID | JSONB | SECURITY DEFINER; institution_admin+ |

### 2.6 Quota Functions
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `consume_ai_quota(p_resident_id, p_count)` | UUID, INT DEFAULT 1 | JSONB | SECURITY DEFINER; authenticated |
| `grant_ai_quota(p_resident_id, p_new_limit, p_reset)` | UUID, INT, BOOLEAN DEFAULT true | JSONB | SECURITY DEFINER; authenticated (director+) |

### 2.7 Rate Limiting
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `check_rate_limit(p_key, p_max, p_window_seconds)` | TEXT, INT DEFAULT 30, INT DEFAULT 60 | JSONB | SECURITY DEFINER; authenticated + service_role |

### 2.8 Data Retention
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `enforce_data_retention()` | none | void | SECURITY DEFINER; service_role only |
| `set_data_retention(p_tenant_id, p_data_retention_days, p_purge_now)` | UUID, INT, BOOLEAN DEFAULT FALSE | JSONB | SECURITY DEFINER; authenticated (director+) |

### 2.9 MRN Hashing
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `hash_patient_mrn(p_mrn, p_tenant_id)` | TEXT, UUID | TEXT | SECURITY DEFINER; authenticated + service_role |
| `hash_scim_token(p_token)` | TEXT | TEXT | SQL IMMUTABLE PARALLEL SAFE |

### 2.10 MRN & Age Helpers
| Function | Params | Return | Security | Notes |
|----------|--------|--------|----------|-------|
| `calculate_age_at_procedure(p_dob, p_procedure_date)` | DATE, DATE | INTEGER | IMMUTABLE | |

### 2.11 Backup
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `log_backup_run(p_status, p_size_bytes, p_notes)` | TEXT, BIGINT, TEXT | BIGINT | SECURITY DEFINER SET search_path = `public, pg_temp` |

### 2.12 Stripe Helper
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `mark_stripe_event_failed(p_event_id, p_reason)` | TEXT, TEXT | void | SECURITY DEFINER; service_role only |

### 2.13 Cache Cleanup
| Function | Params | Return | Security |
|----------|--------|--------|----------|
| `cleanup_ai_response_cache()` | none | void | SET search_path = `pg_catalog, public` |

### 2.14 Audit Trigger Functions
| Function | Description |
|----------|-------------|
| `update_updated_at()` | Sets `NEW.updated_at = NOW()` — used by many triggers |
| `audit_case_entry()` | PHI-stripped audit for case_entries INSERT/UPDATE/DELETE |
| `audit_accreditation_framework()` | Audit for accreditation_frameworks INSERT/UPDATE/DELETE |
| `audit_config_change()` | Redacts secrets when auditing ai_config / payment_gateway_config |
| `audit_table_change(p_excluded_cols)` | Generic audit function for bulk-attached tables (00056) |
| `audit_program_goals()` | Audit for program_goals (00067) |
| `audit_case_templates()` | Audit for case_templates (00067) |
| `audit_profile_changes()` | Audit for profile role/tenant changes (00067) |
| `reject_audit_mutation()` | Blocks UPDATE/DELETE on audit_logs unconditionally |
| `auto_approve_individual()` | Auto-approves entries for individual tenants |
| `recalc_goal_progress()` | Recalculates goal_progress on case_entry changes |
| `write_once_submitted_check()` | Blocks resident modification of submitted entries (allows rejected→draft) |
| `enforce_case_status_transition()` | Enforces state machine: draft→pending→approved/rejected→draft |
| `block_lapsed_tenant_submit()` | Blocks case submission for lapsed institutional subscriptions |
| `handle_new_user()` | Auto-creates tenant + profile on auth.users INSERT |
| `set_program_goals_updated_at()` | Sets updated_at on program_goals |
| `touch_updated_at()` | **REFERENCED BUT NOT DEFINED** — used by tenant_sso_configs and tenant_webhooks triggers |

---

## 3. TRIGGERS

| Trigger Name | Table | Timing | Event | Function |
|-------------|-------|--------|-------|----------|
| `set_updated_at` | institutions, tenants, profiles, case_templates, case_entries, subscriptions, ai_config, payment_gateway_config, accreditation_frameworks, institution_billing | BEFORE | UPDATE | `update_updated_at()` |
| `on_auth_user_created` | auth.users | AFTER | INSERT | `handle_new_user()` |
| `trg_audit_case_entry` | case_entries | AFTER | INSERT/UPDATE/DELETE | `audit_case_entry()` |
| `trg_auto_approve_individual` | case_entries | BEFORE | INSERT/UPDATE | `auto_approve_individual()` |
| `trg_update_goal_progress` | case_entries | AFTER | INSERT/UPDATE/DELETE | `recalc_goal_progress()` |
| `trg_write_once_submitted_check` | case_entries | BEFORE | UPDATE | `write_once_submitted_check()` |
| `trg_enforce_case_status_transition` | case_entries | BEFORE | UPDATE | `enforce_case_status_transition()` |
| `trg_block_lapsed_tenant_submit` | case_entries | BEFORE | INSERT | `block_lapsed_tenant_submit()` |
| `trg_audit_accreditation_framework` | accreditation_frameworks | AFTER | INSERT/UPDATE/DELETE | `audit_accreditation_framework()` |
| `trg_audit_ai_config` | ai_config | AFTER | INSERT/UPDATE/DELETE | `audit_config_change()` |
| `trg_audit_payment_gateway` | payment_gateway_config | AFTER | INSERT/UPDATE/DELETE | `audit_config_change()` |
| `trg_reject_audit_update` | audit_logs | BEFORE | UPDATE | `reject_audit_mutation()` |
| `trg_reject_audit_delete` | audit_logs | BEFORE | DELETE | `reject_audit_mutation()` |
| `trg_audit_*` (dynamic) | profiles, tenants, subscriptions, payments, consent_records, approval_requests, case_attachments, stripe_events, resident_ai_toggle, institutions, case_templates, program_goals | AFTER | INSERT/UPDATE/DELETE | `audit_table_change()` |
| `trg_audit_case_templates` | case_templates | AFTER | INSERT/UPDATE/DELETE | `audit_case_templates()` |
| `trg_audit_program_goals` | program_goals | AFTER | INSERT/UPDATE/DELETE | `audit_program_goals()` |
| `trg_audit_profile` | profiles | AFTER | UPDATE | `audit_profile_changes()` |
| `set_program_goals_updated_at` | program_goals | BEFORE | UPDATE | `set_program_goals_updated_at()` |
| `tenant_sso_configs_touch` | tenant_sso_configs | BEFORE | UPDATE | `touch_updated_at()` **MISSING** |
| `tenant_webhooks_touch` | tenant_webhooks | BEFORE | UPDATE | `touch_updated_at()` **MISSING** |

---

## 4. VIEWS

| View Name | Query Description | Security |
|-----------|------------------|----------|
| `secret_ai_config` | Decrypts `api_key_enc` via `decrypt_with_version(api_key_enc, key_version)`; WHERE tenant matches or admin | `security_barrier=true`; SELECT GRANTed to authenticated |
| `secret_payment_gateway_config` | Decrypts `secret_key_enc` and `webhook_secret_enc`; WHERE tenant matches or admin | `security_barrier=true`; SELECT GRANTed to authenticated |
| `secret_tenant_webhooks` | Decrypts `secret_enc`; WHERE tenant matches or admin | `security_barrier=true`; SELECT GRANTed to authenticated |
| `tenant_storage_usage_mb` | Per-tenant storage used (SUM from storage.objects for bucket 'case-attachments') vs quota_mb from subscription_plans | SELECT GRANTed to authenticated |
| `duty_weekly_violations` | GROUP BY tenant_id, resident_id, week_start; HAVING SUM(hours_worked) > 80 | `security_invoker=true` (RLS of duty_periods applies) |
| `resident_evaluation_averages` | AVG(clinical_skills, professionalism, procedures), COUNT(*) per resident | No explicit security_invoker |

**Dropped Views:** `case_stats_mv` (materialized view, dropped in 00066)

---

## 5. EDGE FUNCTIONS

### 5.1 `ai-insights` — /functions/v1/ai-insights
- **Auth:** JWT bearer token; reads tenant_id + role from `user.app_metadata`
- **Method:** POST, OPTIONS (CORS)
- **Auth flow:** Calls `authenticate()` from `_shared/auth.ts`
- **Resident scoping:** Verifies `resident_id` matches caller ID OR caller has elevated role
- **Safety:** Rejects requests where `is_deidentified !== true` (no PHI to AI)
- **Quota check:** Reads `resident_ai_toggle`; checks quota_used < quota_limit
- **Rate limit:** Application-level check (20 queries/minute/resident via ai_query_logs)
- **Cache:** Dual-layer: in-memory Map (5min TTL, 200 entries) + `ai_response_cache` table
- **AI config:** Reads from `secret_ai_config` view (decrypts API key)
- **Timeout:** 30-second timeout on AI provider call via AbortController
- **Safety filtering:** Three regex patterns flag blocked_diagnosis, blocked_prescription, blocked_prognosis
- **Disclaimer:** Appends educational reflection tool disclaimer to response
- **Streaming:** Supports `stream` parameter (boolean)

### 5.2 `generate-pdf` — /functions/v1/generate-pdf
- **Auth:** JWT bearer (via `authenticate()`)
- **Method:** POST
- **Rate limit:** 10 PDFs/minute per user via `check_rate_limit('pdf:{userId}')`
- **Input:** `case_ids[]`, `resident_name`, `tenant`
- **Max cases:** 100 per PDF
- **Output:** application/pdf with table of cases (date, template)
- **Audit:** Writes `pdf_export` entry to audit_logs
- **CORS:** Standard headers from `_shared/auth.ts`

### 5.3 `create-checkout` — /functions/v1/create-checkout
- **Auth:** JWT bearer; requires `director`, `institution_admin`, or `admin` role
- **In-memory rate limit:** 5 checkout sessions/minute per tenant_id
- **Input:** `plan_id`, `gateway` (default 'stripe')
- **Flow:** Reads plan → reads `secret_payment_gateway_config` → creates Stripe CheckoutSession
- **Stripe API:** Uses `stripe@14.21.0` with `2024-06-20` API version

### 5.4 `payment-webhook` — /functions/v1/payment-webhook
- **Auth:** Stripe webhook signature verification (`stripe-signature` header)
- **Mode isolation:** Checks `event.livemode` vs gateway config `mode` ('test'/'live')
- **Idempotency:** `stripe_events.stripe_event_id` UNIQUE constraint + duplicate detection
- **Config cache:** In-memory Map keyed by `stripeAccountId` with 5min TTL (per-tenant isolation)
- **Service role:** Uses `SUPABASE_SERVICE_ROLE_KEY`
- **Events handled:**
  - `checkout.session.completed` — Creates/updates subscription
  - `customer.subscription.deleted` — Sets subscription status='canceled'
  - `invoice.paid` — Updates subscription period dates
- **⚠ Limitation:** `readTenantSlug()` always returns null — requires Stripe Connect mapping

### 5.5 `sso-callback` — /functions/v1/sso-callback
- **No JWT auth** — browser redirect entry point
- **Query params:** `tenant` (slug), `protocol` (saml/oidc), `metadata`, `discovery`, `next`
- **Flow:** Validates tenant exists → reads `tenant_sso_configs` (active, matching protocol) → returns 302 redirect to IdP
- **Audit:** Logs `sso_start` event to audit_logs
- **Safety:** `next` param sanitized via regex; fails closed if protocol unsupported

### 5.6 `dispatch-webhook` — /functions/v1/dispatch-webhook
- **Intended invocation:** By Postgres triggers via `pg_net`
- **Auth:** Relies on `SUPABASE_SERVICE_ROLE_KEY` (no JWT check)
- **Input:** `tenant_id`, `event_type`, `event_id`, `data`
- **Flow:** Reads `tenant_webhooks` matching tenant_id + is_active → filters by events match → HMAC-SHA256 signs payload → POSTs to webhook URL
- **Headers sent:** `Content-Type`, `X-E-Logbook-Event`, `X-E-Logbook-Event-Id`, `X-E-Logbook-Signature: sha256=...`
- **Delivery recording:** Every attempt recorded to `tenant_webhook_deliveries`
- **⚠ Stub:** No retry, DLQ, or replay logic

### 5.7 `scim` — /functions/v1/scim
- **Auth:** Bearer token → SHA-256 hashed → looked up in `scim_tokens`
- **Endpoints:**
  - `GET /scim/v2/Users` — List all profiles in tenant
  - `GET /scim/v2/Users/{id}` — Read profile
  - `POST /scim/v2/Users` — Creates user via `invite_user` RPC (**MISSING RPC**)
  - `PATCH /scim/v2/Users/{id}` — Updates role or active state
  - `DELETE /scim/v2/Users/{id}` — Soft-disable (sets `disabled_at`)
- **SCIM compliance:** Returns SCIM 2.0 User schema; pagination/filtering/etag out of scope
- **Output format:** `application/scim+json`

### 5.8 `list-invoices` — /functions/v1/list-invoices (standalone)
- **Auth:** JWT bearer
- **Query param:** `customer_id` (Stripe customer ID)
- **Flow:** Gets user → reads subscription → lists Stripe invoices (max 20)
- **⚠ Note:** Uses `STRIPE_SECRET_KEY` env var directly; not tenant-scoped config

### 5.9 `_shared/auth.ts` — Shared auth utilities
- `authenticate(request)` — Parses JWT, returns `{ supabase, user, tenantId, role }` or 401/403 Response
- `corsHeaders(origin)` — Returns CORS headers; validates against ALLOWED_ORIGINS
- `escapeHtml(text)` — HTML entity escaping

---

## 6. ENCRYPTION PATTERNS

### 6.1 pgcrypto Symmetric Encryption
All secrets use `pgp_sym_encrypt` / `pgp_sym_decrypt` from the `pgcrypto` extension.

**Encryption key resolution:**
- Primary: `app.encryption_key_v{version}` GUC (versioned)
- Fallback for v1: `app.encryption_key` (legacy, unversioned)
- Keys are hex-encoded 32-byte (or longer) strings set as PostgreSQL custom GUCs

**Encrypted columns (BYTEA):**
- `ai_config.api_key_enc`
- `payment_gateway_config.secret_key_enc`
- `payment_gateway_config.webhook_secret_enc`
- `tenant_webhooks.secret_enc`

### 6.2 Key Versioning
- `key_version` column on `ai_config` (INT NOT NULL DEFAULT 1)
- `key_version` column on `payment_gateway_config` (INT NOT NULL DEFAULT 1)
- `salt_version` column on `tenants` (INT NOT NULL DEFAULT 1)
- `decrypt_with_version(bytes, version)` function resolves correct GUC
- `rotate_encryption_key(old_v, new_v)` decrypts with old key, re-encrypts with new, bumps key_version
- `rotate_mrn_salt(tenant_id)` generates new random salt, bumps salt_version (does NOT re-hash)

### 6.3 Secret Views
Three `secret_*` views mediate access to encrypted columns:
- `secret_ai_config` — decrypts api_key_enc
- `secret_payment_gateway_config` — decrypts secret_key_enc, webhook_secret_enc
- `secret_tenant_webhooks` — decrypts secret_enc

All use `security_barrier=true` and WHERE-clause tenant scoping.

### 6.4 MRN Hashing (Not Encryption — One-Way Hash)
- `hash_patient_mrn(mrn, tenant_id)` → SHA-256 hash using per-tenant salt (`tenants.mrn_hash_salt`)
- MRN salt is 32 bytes of `gen_random_bytes(32)` stored per-tenant
- `patient_hash` column on `case_entries` stores the hash
- `hash_scim_token(token)` → SHA-256 for SCIM bearer token storage

### 6.5 Audit Secret Redaction
- `audit_config_change()` strips `encrypted_api_key`, `encrypted_secret_key`, `encrypted_webhook_secret`, `api_key_enc`, `secret_key_enc`, `webhook_secret_enc` from audit log entries
- `audit_case_entry()` strips `patient_mrn` and `patient_dob` from case entry audit logs

---

## 7. MIGRATION SEQUENCE

| # | File | Purpose |
|---|------|---------|
| 00001 | `schema.sql` | Core schema: all base tables + pgcrypto extension + `update_updated_at()` trigger |
| 00002 | `rls_policies.sql` | Full RLS policies + `get_tenant_id()`/`get_user_role()` helpers |
| 00003 | `triggers.sql` | `audit_case_entry()`, `auto_approve_individual()`, `recalc_goal_progress()`, `get_case_stats()`, `write_once_submitted_check()`, `audit_accreditation_framework()` |
| 00004 | `auth_triggers.sql` | `handle_new_user()` — auto-create tenant+profile on signup |
| 00005 | `seed_data.sql` | Subscription plans + default case templates |
| 00006 | `demo_accounts.sql` | Demo users (resident-5@demo.com etc.) |
| 00007 | `enterprise_upgrade.sql` | De-identification columns, accreditation_frameworks, attachment_signatures, institution_billing, `hash_patient_mrn()`, `calculate_age_at_procedure()` |
| 00008 | `premium_mobile_logbook.sql` | Tenant compliance fields (region, data_retention_days, consent, compliance_frameworks); AI log safety tracking |
| 00009 | `concurrent_approval_lock.sql` | `approve_case()`/`reject_case()` with `FOR UPDATE` locking |
| 00010 | `lapsed_tenant_write_guard.sql` | RLS policy + trigger `block_lapsed_tenant_submit()` |
| 00011 | `critical_schema_fixes.sql` | UNIQUE INDEX on approval_requests; CHECK constraints; compound indexes; soft-delete columns; stripe_price_id; FK fix (RESTRICT); status state machine trigger; updated `hash_patient_mrn()` |
| 00012 | `rls_security_fixes.sql` | Block audit_logs INSERT; restrict profile INSERT roles; role CHECK constraint; auth checks in approve/reject_case; fixed get_case_stats (JWT-based); fixed lapsed-tenant guards; restricted handle_new_user roles; added deleted_at IS NULL to select policies |
| 00013 | `audit_phi_redaction.sql` | PHI-stripped `audit_case_entry()`; consent_records table; `enforce_data_retention()` |
| 00014 | `audit_logs_select_policy.sql` | Added SELECT policies for audit_logs (supervisors, residents) |
| 00015 | `approval_requests_unique_constraint.sql` | UNIQUE CONSTRAINT on (entry_id, supervisor_id) |
| 00016 | `case_stats_materialized_view.sql` | `case_stats_mv` materialized view + `refresh_case_stats_mv()` + updated `get_case_stats()` |
| 00017 | `missing_indexes.sql` | 5 performance indexes (resident_status, approval supervisor, ai_query_logs, cursor pagination, audit user) |
| 00018 | `ai_response_cache.sql` | ai_response_cache table + `cleanup_ai_response_cache()` |
| 00019 | `fix_consent_records_rls.sql` | Fix consent_records admin RLS policy (p.user_id = auth.uid()) |
| 00020 | `secure_definer_search_path.sql` | SET search_path='' on ALL SECURITY DEFINER functions; hash_patient_mrn IMMUTABLE→STABLE |
| 00021 | `create_stripe_events.sql` | stripe_events table for webhook idempotency |
| 00022 | `add_subscriptions_tenant_unique.sql` | UNIQUE(tenant_id) on subscriptions + gateway_subscription_id index |
| 00023 | `fix_resident_resubmit.sql` | Allow rejected→draft in `write_once_submitted_check()` |
| 00024 | `add_ai_quota_used.sql` | quota_used column + CHECK(>=0) on resident_ai_toggle |
| 00025 | `add_brin_indexes_phi_check.sql` | BRIN indexes; `deidentified_no_phi` CHECK constraint |
| 00026 | `fix_stripe_events_rls.sql` | Fixed stripe_events RLS (auth.role() instead of current_user) |
| 00027 | `add_rls_ai_response_cache.sql` | RLS on ai_response_cache |
| 00028 | `add_missing_tenant_id.sql` | tenant_id columns on case_attachments, one_time_purchases, approval_requests + updated RLS policies |
| 00029 | `add_missing_constraints_indexes.sql` | CHECK constraints + performance indexes |
| 00030 | `add_case_attachment_audit.sql` | file_name, file_size, uploaded_by on case_attachments |
| 00031 | `add_program_goal_timestamps.sql` | updated_at, deleted_at + trigger on program_goals |
| (00032–00047) | **MISSING** | Removed during renumbering |
| 00048 | `fix_approval_tenant_id.sql` | Fix approve_case/reject_case to include tenant_id in INSERT |
| 00049 | `force_rls_all_tables.sql` | FORCE ROW LEVEL SECURITY on all tenant-scoped tables |
| 00050 | `redact_secrets_in_audit.sql` | `audit_config_change()` redacts secrets + triggers on ai_config, payment_gateway_config |
| 00051 | `audit_logs_append_only.sql` | REVOKE UPDATE/DELETE on audit_logs + reject_audit_mutation triggers |
| 00052 | `normalize_search_path.sql` | Set search_path='pg_catalog, public' on ALL SECURITY DEFINER functions |
| 00053 | `encrypt_secrets.sql` | *_enc BYTEA columns; backfill; drop deprecated plaintext; decrypt views; store RPCs |
| 00054 | `ai_quota_atomic_increment.sql` | consume_ai_quota/grant_ai_quota RPCs; REVOKE UPDATE on resident_ai_toggle |
| 00055 | `p2_batch_misc.sql` | rate_limits table + check_rate_limit; fix profiles INSERT policy; ai_query_logs INSERT policy; institutions SELECT policy; subscriptions partial UNIQUE; demo gate; get_case_stats new signature; rejected entry UPDATE policy; block_lapsed_tenant_submit rewrite; tenant mrn_hash_salt; enforce_data_retention expansion |
| 00056 | `audit_triggers_and_cron.sql` | Generic audit_table_change() + triggers on 12 tables; pg_cron job scheduling |
| 00057 | `stripe_events_failure_recording.sql` | status, failure_reason, tenant_id, payload, signature_valid columns + mark_stripe_event_failed RPC |
| 00058 | `tenant_sso_configs.sql` | tenant_sso_configs table + RLS + trigger (references MISSING touch_updated_at) |
| 00059 | `retention_admin_rpc.sql` | set_data_retention RPC with bounds 365–3650 days |
| 00060 | `consent_types_extension.sql` | Extend consent_type CHECK to include research, analytics, data_sharing |
| 00061 | `storage_quotas.sql` | storage_quota_mb on subscription_plans + tenant_storage_usage_mb view |
| 00062 | `key_rotation.sql` | salt_version on tenants; decrypt_with_version, rotate_encryption_key, rotate_mrn_salt; updated secret views |
| 00063 | `tenant_webhooks.sql` | tenant_webhooks + tenant_webhook_deliveries tables + RLS + triggers (references MISSING touch_updated_at) |
| 00064 | `scim_tokens.sql` | scim_tokens table + hash_scim_token function |
| 00064 | `onboarding_flag.sql` | onboarding_completed on profiles |
| 00065 | `compliance_audit_gaps.sql` | Fix accreditation_framework trigger; add audit triggers for case_templates, program_goals; data retention audit logging |
| 00066 | `performance_indexes.sql` | Drop orphaned case_stats_mv; add profiles(tenant_id,role), audit_logs(tenant_id,created_at), approval_requests(tenant_id) indexes |
| 00067 | `audit_gaps.sql` | audit_program_goals, audit_case_templates, audit_profile_changes functions + triggers |
| 00067 | `template_favorites.sql` | template_favorites table + RLS |
| 00068 | `stripe_customer_id.sql` | stripe_customer_id on subscriptions |
| 00069 | `duty_tracking.sql` | duty_periods table + duty_weekly_violations view |
| 00070 | `faculty_evaluations.sql` | faculty_evaluations table + resident_evaluation_averages view |
| 00071 | `fix_duty_periods_rls.sql` | Fix duty_periods WITH CHECK; duty_weekly_violations security_invoker=true |
| 00072 | `fix_faculty_evals_rls.sql` | Fix faculty_evaluations WITH CHECK (evaluator/resident same tenant) |
| 00073 | `performance_indexes_v2.sql` | 16 new performance indexes |
| 00074 | `tenant_webhooks_encrypt.sql` | secret_enc column; store_tenant_webhook RPC; secret_tenant_webhooks view |
| 00076 | `backup_schedule.sql` | scheduled_backup_log table + log_backup_run RPC + pg_cron setup comments |

**Timestamp-named duplicates** (identical to numbered versions):
- `20260701100421_00028_add_missing_tenant_id.sql` — Simplified version (only approval_requests tenant_id)
- `20260701100432_00049_force_rls_all_tables.sql` — Simpler DO block (fewer tables, no stripe_events)
- `20260701100756_00050_redact_secrets_in_audit.sql.sql` — Same as 00050
- `20260701100811_00051_audit_logs_append_only.sql.sql` — Same as 00051
- `20260701100827_00052_normalize_search_path.sql.sql` — Same as 00052
- `20260701100901_00053_encrypt_secrets.sql.sql` — Same as 00053
- `20260701100923_00054_ai_quota_atomic_increment.sql.sql` — Same as 00054
- `20260701100951_00061_storage_quotas.sql.sql` — Same as 00061
- `20260701101027_00062_key_rotation.sql.sql` — Same as 00062 (minor: uses NULL instead of `app.actor_id` in audit columns)
- `20260701101033_00063_scim_tokens.sql.sql` — Same as 00064 (uses `get_user_role()` instead of `current_role_global()`)
- `20260701101053_00058_tenant_sso_configs_v3.sql.sql` — Same as 00058 (uses `get_tenant_id()`/`get_user_role()` instead of `current_role_*`)

---

## 8. SEED DATA

### 8.1 Subscription Plans (5 plans)
| ID | Name | Price | Tenant Type | Max Residents | Features |
|----|------|-------|-------------|---------------|----------|
| ...001 | Free | $0.00 | individual | NULL | max_cases:20, templates:basic, AI/PDF/approval/goals false |
| ...002 | Individual Premium | $9.99 | individual | NULL | max_cases:∞, AI/PDF/goals true |
| ...003 | Institution Basic | $49.99 | institution | 10 | PDF/approval true, AI false |
| ...004 | Institution Pro | $149.99 | institution | 50 | AI/PDF/approval/goals/audit true |
| ...005 | Institution Enterprise | $0.00 | institution | NULL | All features + SSO/dedicated_support/BAA |

### 8.2 Global Templates Tenant
- `00000000-0000-0000-0000-000000000000` — system tenant for global templates
- Surgery template (00000000-...010) — 6 fields (procedure_name, anesthesia_type, supervision_level, complications, outcome, duration_minutes, assistant_name)
- Radiology template (00000000-...011) — 8 fields (modality, body_part, clinical_indication, findings, impression, contrast_used, comparison_studies, urgency)

### 8.3 Demo Accounts (via 00006)
5 users in 'Demo Hospital' tenant: resident, supervisor, director, institution_admin, platform admin
All with password hash: `$2b$10$6BroQh/IHi2pYC3/yl6m5u.gSevmmX134eauRv56gxonOjiv9wplC`

---

## 9. TEST FILES

### 9.1 `tests/rls-policies.sql`
8 RLS test scenarios with `set_config('request.jwt.claims', ...)`:
- Resident sees own case_entries only
- Supervisor sees all tenant cases
- Resident cannot modify submitted cases
- Resident can modify rejected cases (resubmit)
- Only admin/institution_admin can read ai_config
- Deleted records excluded from SELECT
- Consent records visible within tenant

### 9.2 `tests/00062_key_rotation.test.sql`
Full round-trip integration test in a transaction (ROLLBACK at end):
- Sets up app.encryption_key_v1 and v2 GUCs
- Inserts test rows encrypted with v1
- Verifies v1 decrypt
- Calls rotate_encryption_key(1,2)
- Verifies v2 decrypt returns same plaintext
- Verifies key_version=2
- Tests idempotency
- Verifies audit_logs key_rotation row

### 9.3 `tests/p0_5_approval_tenant_id.sql`
Regression test for 00048 fix:
- Sets JWT claims as supervisor in tenant-a
- Calls approve_case() and reject_case()
- Verifies approval_requests.tenant_id is populated and correct

### 9.4 `tests/p0_6_force_rls.sql`
Verifies all 24 tenant-scoped tables have RLS enabled AND FORCEd:
- Checks `relrowsecurity` and `relforcerowsecurity` via pg_class

---

## 10. MISSING FUNCTION REFERENCES

The following functions are **referenced but not defined** in any migration file:

| Function | Referenced By | Impact |
|----------|---------------|--------|
| `current_role_in_tenant(UUID, TEXT[])` | 00058, 00063 RLS policies | Migrations 00058 and 00063 will FAIL if applied |
| `current_role_global()` | 00058, 00063, 00064 RLS policies | Same — will fail |
| `touch_updated_at()` | 00058, 00063 triggers | Trigger creation will fail |
| `invite_user(p_tenant_id, p_email, p_full_name, p_role)` | SCIM edge function | SCIM POST /Users will fail at runtime |

These were likely defined in the removed migrations (00032–00047) and never re-created. The timestamp-named duplicates (`20260701101053_00058_tenant_sso_configs_v3.sql.sql` and `20260701101033_00063_scim_tokens.sql.sql`) use `get_tenant_id()`/`get_user_role()` instead, which do exist.

---

## 11. NOTABLE ARCHITECTURAL DECISIONS

- **Phase numbering:** Migrations organized into Phases: 0 (critical fixes), 2 (security hardening), 6 (enterprise features), 7 (encryption/compliance)
- **Multi-tenant isolation:** Every table has `tenant_id` with direct FK and FORCE RLS
- **Audit append-only:** Three defensive layers (privilege REVOKE, RLS default-deny, BEFORE triggers)
- **Encryption:** pgp_sym_encrypt with versioned keys, per-tenant MRN salts, decrypting views
- **Immutable case status:** State machine enforced by trigger (draft→pending→approved/rejected→draft)
- **Cascade policy:** case_entries.resident_id uses ON DELETE RESTRICT (safety guard for resident deletion)
