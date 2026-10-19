# COMPLETE SUPABASE DATABASE SCHEMA MAP FOR ELOGBOOK

## OVERVIEW
- Total Tables: 59
- Total Migrations: 135+
- Database: PostgreSQL with Supabase
- Multi-tenant SaaS architecture with institution hierarchy

## 1. CORE TABLES

### institutions
- id: UUID (PK)
- name: TEXT
- slug: TEXT (UNIQUE)
- settings: JSONB
- tier: TEXT (default 'free')
- created_at, updated_at: TIMESTAMPTZ

### tenants
- id: UUID (PK)
- institution_id: UUID → institutions(id)
- name: TEXT
- slug: TEXT (UNIQUE)
- tenant_type: TEXT ('individual', 'institution')
- plan_id: UUID
- settings: JSONB
- lifecycle_status: TEXT ('active', 'suspended', 'cancelled')
- data_mode: TEXT ('development', 'production')
- created_at, updated_at: TIMESTAMPTZ

### profiles
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- user_id: UUID → auth.users(id) CASCADE UNIQUE
- role: TEXT ('resident', 'supervisor', 'director', 'institution_admin', 'admin')
- full_name: TEXT
- specialty: TEXT
- stripe_customer_id: TEXT
- created_at, updated_at: TIMESTAMPTZ

### case_templates
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- specialty: TEXT
- name: TEXT
- fields: JSONB
- required_fields: JSONB
- is_global: BOOLEAN
- created_at, updated_at: TIMESTAMPTZ

### case_entries
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- template_id: UUID → case_templates(id) RESTRICT
- patient_mrn: TEXT (hashed)
- patient_dob: DATE
- patient_hash: TEXT
- patient_age_years: INTEGER
- case_date: DATE
- field_values: JSONB
- status: TEXT ('draft', 'pending', 'approved', 'rejected')
- accreditation_mappings: JSONB
- is_deidentified: BOOLEAN
- deleted_at: TIMESTAMPTZ (soft delete)
- data_mode: TEXT ('development', 'production')
- created_at, updated_at: TIMESTAMPTZ
- Indexes: tenant, resident, status, field_values (GIN), case_date (BRIN)

### case_attachments
- id: UUID (PK)
- entry_id: UUID → case_entries(id) CASCADE
- file_path: TEXT
- file_type: TEXT
- file_size: BIGINT
- uploaded_at: TIMESTAMPTZ

### approval_requests
- id: UUID (PK)
- entry_id: UUID → case_entries(id) CASCADE
- supervisor_id: UUID → profiles(id)
- status: TEXT ('pending', 'approved', 'rejected')
- comment: TEXT
- requested_at, resolved_at: TIMESTAMPTZ
- UNIQUE(entry_id, supervisor_id)

### audit_logs
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- user_id: UUID → auth.users(id)
- action: TEXT
- resource_type: TEXT
- resource_id: UUID
- changes: JSONB (PHI-redacted)
- ip_address: TEXT
- created_at: TIMESTAMPTZ
- Indexes: tenant, resource(type, id), created_at (BRIN)

### program_goals
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- director_id: UUID → profiles(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- title: TEXT
- target_count: INTEGER
- specialty: TEXT
- deadline: DATE
- description: TEXT
- created_at, updated_at: TIMESTAMPTZ

### goal_progress
- id: UUID (PK)
- goal_id: UUID → program_goals(id) CASCADE UNIQUE
- resident_id: UUID → profiles(id) CASCADE
- current_count: INTEGER
- last_updated: TIMESTAMPTZ

## 2. SUBSCRIPTION & BILLING TABLES

### subscription_plans
- id: UUID (PK)
- name: TEXT
- slug: TEXT UNIQUE
- price_monthly: NUMERIC(10,2)
- features: JSONB
- tenant_type: TEXT ('individual', 'institution')
- max_residents: INTEGER
- created_at: TIMESTAMPTZ

### subscriptions
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE UNIQUE
- plan_id: UUID → subscription_plans(id)
- status: TEXT ('active', 'canceled', 'past_due', 'unpaid', 'trialing')
- gateway_subscription_id: TEXT
- current_period_start, current_period_end: TIMESTAMPTZ
- created_at, updated_at: TIMESTAMPTZ

### payments
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- amount: NUMERIC(10,2)
- currency: TEXT
- gateway_payment_intent_id: TEXT
- status: TEXT
- created_at: TIMESTAMPTZ

### one_time_purchases
- id: UUID (PK)
- resident_id: UUID → profiles(id) CASCADE
- purchase_type: TEXT
- amount: NUMERIC(10,2)
- gateway_payment_intent_id: TEXT
- status: TEXT
- consumed: BOOLEAN
- created_at: TIMESTAMPTZ

### stripe_events
- id: UUID (PK)
- stripe_event_id: TEXT UNIQUE
- event_type: TEXT
- processed: BOOLEAN
- failure_count: INTEGER
- last_error: TEXT
- created_at, processed_at: TIMESTAMPTZ

### institution_billing
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- billing_period_start, billing_period_end: DATE
- active_residents: INTEGER
- base_amount, per_resident_fee, total_amount: NUMERIC(10,2)
- status: TEXT ('draft', 'sent', 'paid', 'overdue', 'canceled')
- invoice_url: TEXT
- created_at, updated_at: TIMESTAMPTZ

### custom_plan_features
- id: UUID (PK)
- plan_id: UUID → subscription_plans(id) CASCADE
- feature_key: TEXT
- feature_value: JSONB
- created_at: TIMESTAMPTZ
- UNIQUE(plan_id, feature_key)

### payment_gateway_config
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE UNIQUE
- provider: TEXT ('stripe', 'paddle', 'lemonsqueezy', 'custom')
- publishable_key: TEXT
- encrypted_secret_key: TEXT
- encrypted_webhook_secret: TEXT
- endpoint_url: TEXT
- is_active: BOOLEAN
- created_at, updated_at: TIMESTAMPTZ

## 3. AI & CACHING TABLES

### ai_config
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE UNIQUE
- provider: TEXT ('openai', 'anthropic', 'azure', 'openrouter', 'aihubmix', 'custom')
- model: TEXT
- encrypted_api_key: TEXT
- endpoint_url: TEXT
- response_format: TEXT ('text', 'stream')
- is_active: BOOLEAN
- created_at, updated_at: TIMESTAMPTZ

### resident_ai_toggle
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- enabled: BOOLEAN
- quota_limit, quota_used: INTEGER
- created_at: TIMESTAMPTZ
- UNIQUE(tenant_id, resident_id)

### ai_query_logs
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- query, response: TEXT
- tokens_used: INTEGER
- created_at: TIMESTAMPTZ

### ai_response_cache
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- query_hash: TEXT
- query_text, response_text: TEXT
- tokens_used: INTEGER
- model, provider: TEXT
- created_at, expires_at: TIMESTAMPTZ
- UNIQUE(tenant_id, resident_id, query_hash)

## 4. ACCREDITATION & EDUCATION TABLES

### accreditation_frameworks
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- name: TEXT
- version: TEXT
- framework_type: TEXT ('acgme', 'scfhs', 'gmc', 'canmeds', 'custom')
- milestones: JSONB
- created_at, updated_at: TIMESTAMPTZ

### rotations
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- title, specialty: TEXT
- start_date, end_date: DATE
- site: TEXT
- supervisor_id: UUID → profiles(id)
- status: TEXT ('scheduled', 'active', 'completed', 'cancelled')
- notes: TEXT
- created_at, updated_at: TIMESTAMPTZ

### milestones
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- competency_area, sub_competency: TEXT
- level: INTEGER (1-5)
- assessor_id: UUID → profiles(id)
- assessment_date: DATE
- evidence_entry_id: UUID → case_entries(id)
- comments: TEXT
- created_at, updated_at: TIMESTAMPTZ
- UNIQUE(tenant_id, resident_id, sub_competency, assessment_date)

### evaluation_forms
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- evaluator_id: UUID → profiles(id)
- form_type: TEXT ('mini_cex', 'dops', 'cbd', 'cex', 'msf', 'osce', '360_review', 'portfolio_review')
- rotation_id: UUID → rotations(id)
- form_data: JSONB
- status: TEXT ('draft', 'submitted', 'reviewed')
- submitted_at: TIMESTAMPTZ
- created_at, updated_at: TIMESTAMPTZ

### faculty_evaluations
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- evaluator_id: UUID → profiles(id) CASCADE
- evaluation_date: DATE
- clinical_skills, professionalism, procedures: INTEGER (1-5)
- comments: TEXT
- created_at: TIMESTAMPTZ

### duty_periods
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- shift_date: DATE
- hours_worked: DECIMAL(4,2) (0-24)
- shift_type: TEXT ('call', 'clinic', 'vacation', 'weekend', 'regular')
- notes: TEXT
- created_at, updated_at: TIMESTAMPTZ

### shifts
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- start_time, end_time: TIMESTAMPTZ
- shift_type: TEXT
- location: TEXT
- created_at, updated_at: TIMESTAMPTZ

### epa_mappings
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- case_entry_id: UUID → case_entries(id) CASCADE
- epa_code: TEXT
- competency_level: INTEGER
- assessor_notes: TEXT
- created_at: TIMESTAMPTZ

### procedure_codes
- id: UUID (PK)
- code: TEXT
- code_system: TEXT ('cpt', 'icd10', 'snomed')
- description: TEXT
- category: TEXT
- rvu: NUMERIC(5,2)
- parent_code: TEXT
- created_at: TIMESTAMPTZ

### scholarly_activities
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- activity_type: TEXT ('publication', 'presentation', 'poster', 'research', 'irb', 'grant', 'book_chapter')
- title, journal, authors: TEXT
- date: DATE
- doi: TEXT
- status: TEXT ('submitted', 'accepted', 'published', 'rejected')
- created_at, updated_at: TIMESTAMPTZ

### benchmark_data
- id: UUID (PK)
- specialty, procedure_type: TEXT
- avg_cases_per_resident: NUMERIC(5,1)
- tenant_count, total_residents: INTEGER
- period: TEXT
- created_at: TIMESTAMPTZ
- UNIQUE(specialty, procedure_type, period)

## 5. AUTHENTICATION & SECURITY TABLES

### consent_records
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- user_id: UUID → auth.users(id) CASCADE
- consent_type: TEXT ('data_processing', 'ai_insights', 'data_export', 'marketing', 'analytics', 'third_party')
- granted_at, revoked_at: TIMESTAMPTZ
- version: TEXT
- ip_address: TEXT
- created_at: TIMESTAMPTZ

### tenant_sso_configs
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- protocol: TEXT ('saml', 'oidc')
- metadata_url, discovery_url: TEXT
- idp_entity_id, idp_certificate: TEXT
- client_id, client_secret_encrypted: TEXT
- default_role: TEXT ('resident', 'supervisor', 'director', 'institution_admin')
- is_active: BOOLEAN
- created_at, updated_at: TIMESTAMPTZ
- UNIQUE(tenant_id, protocol)

### scim_tokens
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- token_hash: TEXT UNIQUE
- description: TEXT
- created_by: UUID → auth.users(id)
- created_at, last_used_at, revoked_at: TIMESTAMPTZ

### tenant_invites
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- email: TEXT
- invited_by: UUID → auth.users(id)
- role: TEXT ('resident', 'supervisor', 'director', 'institution_admin', 'admin')
- status: TEXT ('pending', 'accepted', 'expired')
- created_at, accepted_at: TIMESTAMPTZ

### platform_admins
- user_id: UUID (PK) → auth.users(id) CASCADE
- status: TEXT ('active', 'suspended', 'revoked')
- granted_by: UUID → auth.users(id)
- reason: TEXT
- created_at, updated_at: TIMESTAMPTZ

### platform_tenant_access
- id: UUID (PK)
- admin_user_id: UUID → platform_admins(user_id) CASCADE
- tenant_id: UUID → tenants(id) CASCADE
- reason: TEXT
- expires_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ

## 6. NOTIFICATION & COMMUNICATION TABLES

### notifications
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- user_id: UUID → auth.users(id) CASCADE
- type: TEXT
- title, body: TEXT
- link: TEXT
- read_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ

### push_tokens
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- user_id: UUID → auth.users(id) CASCADE
- token: TEXT UNIQUE
- platform: TEXT ('ios', 'android')
- active: BOOLEAN
- created_at, last_seen_at: TIMESTAMPTZ

### tenant_webhooks
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- url: TEXT (HTTPS only)
- events: TEXT[]
- secret: TEXT (encrypted)
- is_active: BOOLEAN
- description: TEXT
- created_at, updated_at: TIMESTAMPTZ

### tenant_webhook_deliveries
- id: UUID (PK)
- webhook_id: UUID → tenant_webhooks(id) CASCADE
- event_type: TEXT
- payload: JSONB
- response_status: INTEGER
- response_body: TEXT
- delivered_at: TIMESTAMPTZ

### webhook_retry_queue
- id: UUID (PK)
- delivery_id: UUID → tenant_webhook_deliveries(id) CASCADE
- next_attempt_at: TIMESTAMPTZ
- attempt_count, max_attempts: INTEGER
- created_at: TIMESTAMPTZ

### contact_submissions
- id: UUID (PK)
- name, email, message: TEXT
- created_at, responded_at: TIMESTAMPTZ

### comments
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- entry_id: UUID → case_entries(id) CASCADE
- evaluation_id: UUID → evaluation_forms(id) CASCADE
- author_id: UUID → profiles(id) CASCADE
- body: TEXT
- parent_id: UUID → comments(id) CASCADE
- created_at, updated_at: TIMESTAMPTZ
- CHECK: entry_id OR evaluation_id must be set

## 7. WHITE LABEL & CUSTOMIZATION TABLES

### tenant_theme_revisions
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- version: INTEGER
- config: JSONB
- status: TEXT ('draft', 'published', 'archived')
- created_by: UUID → auth.users(id)
- created_at: TIMESTAMPTZ
- UNIQUE(tenant_id, version)

### site_pages
- id: UUID (PK)
- scope: TEXT ('platform', 'tenant')
- tenant_id: UUID → tenants(id) CASCADE
- slug: TEXT
- locale: TEXT (e.g., 'en', 'en-US')
- published_revision_id: UUID → site_page_revisions(id)
- created_at, updated_at: TIMESTAMPTZ
- CHECK: platform scope has NULL tenant_id

### site_page_revisions
- id: UUID (PK)
- page_id: UUID → site_pages(id) CASCADE
- version: INTEGER
- title, content: TEXT
- meta: JSONB
- status: TEXT ('draft', 'published', 'archived')
- published_by: UUID → auth.users(id)
- published_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ

## 8. CONFIGURATION & SETTINGS TABLES

### tenant_settings
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE UNIQUE
- data_retention_days: INTEGER
- require_mfa: BOOLEAN
- allowed_domains: TEXT[]
- feature_flags: JSONB
- created_at, updated_at: TIMESTAMPTZ

### installation_policy
- id: INTEGER (PK, always 1)
- phi_ready: BOOLEAN
- allow_identifiable: BOOLEAN

### subscription_changes
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- from_plan_id: UUID → subscription_plans(id)
- to_plan_id: UUID → subscription_plans(id)
- effective_date: DATE
- reason: TEXT
- created_at: TIMESTAMPTZ

### template_favorites
- user_id: UUID → auth.users(id) CASCADE
- template_id: UUID → case_templates(id) CASCADE
- created_at: TIMESTAMPTZ
- PRIMARY KEY(user_id, template_id)

### attachment_signatures
- id: UUID (PK)
- tenant_id: UUID → tenants(id) CASCADE
- attachment_id: UUID → case_attachments(id) CASCADE
- resident_id: UUID → profiles(id) CASCADE
- signature_hash: TEXT
- verification_method: TEXT ('camera_hash', 'manual_hash', 'device_signature')
- verified_at, created_at: TIMESTAMPTZ

## 9. OPERATIONAL TABLES

### audit_outbox
- id: UUID (PK)
- tenant_id: UUID → tenants(id)
- user_id: UUID → auth.users(id)
- action: TEXT
- resource_type: TEXT
- resource_id: UUID
- changes: JSONB
- error: TEXT
- created_at: TIMESTAMPTZ

### case_operation_log
- op_id: TEXT (PK, 1-64 chars)
- tenant_id: UUID → tenants(id) CASCADE
- actor_profile_id: UUID → profiles(id) CASCADE
- action: TEXT ('insert', 'update', 'delete')
- row_id: UUID
- result: JSONB
- created_at: TIMESTAMPTZ

### scheduled_backup_log
- id: BIGINT (PK, IDENTITY)
- started_at, completed_at: TIMESTAMPTZ
- status: TEXT ('started', 'success', 'failed')
- size_bytes: BIGINT
- notes: TEXT
- created_at: TIMESTAMPTZ

## 10. FOREIGN KEY RELATIONSHIPS

### Core Hierarchy
```
institutions (root)
  └─→ tenants (institution_id)
      ├─→ profiles (tenant_id) CASCADE
      ├─→ case_templates (tenant_id) CASCADE
      ├─→ case_entries (tenant_id) CASCADE
      ├─→ subscriptions (tenant_id) CASCADE UNIQUE
      ├─→ ai_config (tenant_id) CASCADE UNIQUE
      └─→ all tenant-scoped tables CASCADE

auth.users
  └─→ profiles (user_id) CASCADE UNIQUE
      ├─→ case_entries (resident_id) CASCADE
      ├─→ program_goals (resident_id, director_id) CASCADE
      ├─→ rotations (resident_id, supervisor_id)
      └─→ evaluations (resident_id, evaluator_id)

case_entries
  ├─→ case_attachments (entry_id) CASCADE
  ├─→ approval_requests (entry_id) CASCADE
  ├─→ epa_mappings (case_entry_id) CASCADE
  └─→ comments (entry_id) CASCADE

program_goals
  └─→ goal_progress (goal_id) CASCADE UNIQUE

subscription_plans
  └─→ subscriptions (plan_id)
```

## 11. RLS POLICIES SUMMARY

Total policies: 150+

### Policy Patterns

**Tenant Isolation**
- All tables: WHERE tenant_id = get_tenant_id()
- Enforced via SECURITY DEFINER helper functions

**Role Hierarchy**
- resident < supervisor < director < institution_admin < admin
- Higher roles inherit lower permissions

**Key Policies by Table**

**case_entries (15 policies)**
- Resident reads own entries
- Resident updates own draft entries only
- Resident submits (draft → pending)
- Supervisor+ reads all tenant entries
- Supervisor approves/rejects pending entries
- Soft delete policies for residents and supervisors
- Lapsed tenant write guard

**evaluation_forms (6 policies)**
- Residents read own evaluations
- Evaluators insert/update assigned forms
- Supervisors read all tenant evaluations
- Status transition authorization

**notifications (7 policies)**
- Users read own notifications
- Supervisors can insert notifications for residents
- System insert for automated notifications

**audit_logs**
- Director+ reads tenant audit logs
- Insert-only from triggers (SECURITY DEFINER)

**subscriptions, ai_config, payment_gateway_config**
- Admin/institution_admin only

**storage.objects (4 policies)**
- case-attachments bucket
- Tenant members read
- Residents insert
- Supervisors delete

### Critical Guards
- `no_inserts_for_lapsed_tenants`: Prevents writes from expired subscriptions
- `write_once_submitted_check`: Residents cannot modify submitted entries
- `enforce_case_quota`: Blocks inserts beyond plan limits
- `enforce_data_mode`: Production mode prevents identifiable data in dev

## 12. KEY FUNCTIONS

### Security & Helper Functions
```sql
get_tenant_id() → UUID
get_user_role() → TEXT
current_role_in_tenant(uuid) → TEXT
hash_patient_mrn(text, bytea) → TEXT
encrypt_with_version(text, int) → TEXT
decrypt_with_version(text, int) → TEXT
rotate_encryption_key() → VOID
```

### Business Logic
```sql
handle_new_user() → TRIGGER
recalc_goal_progress() → TRIGGER
auto_approve_individual() → TRIGGER
calculate_age_at_procedure(date, date) → INTEGER
scan_field_values_for_phi() → TRIGGER
```

### Case Operations
```sql
approve_case(entry_id uuid, supervisor_id uuid) → VOID
reject_case(entry_id uuid, supervisor_id uuid, comment text) → VOID
soft_delete_case(entry_id uuid) → VOID
submit_case_operation(op_id text, action text, row_id uuid) → JSONB
```

### AI & Quota
```sql
consume_ai_quota(tenant_id uuid, resident_id uuid, tokens int) → VOID
release_ai_quota(tenant_id uuid, resident_id uuid, tokens int) → VOID
grant_ai_quota(tenant_id uuid, resident_id uuid, amount int) → VOID
cleanup_ai_response_cache() → VOID
```

### Analytics
```sql
get_case_stats(tenant_id uuid, resident_id uuid, from_date date, to_date date) → JSONB
get_dashboard_data(tenant_id uuid) → JSONB
get_analytics_data(tenant_id uuid, period text) → JSONB
get_duty_4wk_violations(tenant_id uuid, resident_id uuid) → TABLE
get_template_usage_counts(tenant_id uuid) → TABLE
```

### Sync & Offline
```sql
sync_push_batch(rows jsonb[]) → JSONB
sync_pull_changes(tenant_id uuid, last_sync timestamptz) → TABLE
```

### Admin
```sql
set_data_retention(tenant_id uuid, days int) → VOID
set_user_consent(user_id uuid, type text, granted boolean) → VOID
invite_user(tenant_id uuid, email text, role text) → UUID
authorize_role_change(profile_id uuid, new_role text) → BOOLEAN
```

## 13. TRIGGERS

### Audit Triggers (20+ tables)
```sql
trg_audit_case_entry → audit_logs
trg_audit_case_templates → audit_logs
trg_audit_profiles → audit_logs
trg_audit_program_goals → audit_logs
trg_audit_approval_requests → audit_logs
trg_audit_consent_records → audit_logs
[... 15 more audit triggers]
```

### Business Logic Triggers
```sql
trg_auto_approve_individual → BEFORE INSERT/UPDATE case_entries
trg_update_goal_progress → AFTER INSERT/UPDATE/DELETE case_entries
trg_block_lapsed_tenant_submit → BEFORE INSERT case_entries
trg_case_insert_status → BEFORE INSERT case_entries
on_auth_user_created → AFTER INSERT auth.users
```

### Security Triggers
```sql
trg_write_once_submitted_check → BEFORE UPDATE case_entries
trg_authorize_evalforms_update → BEFORE UPDATE evaluation_forms
trg_authorize_role_change → BEFORE UPDATE profiles
scan_field_values_for_phi → BEFORE INSERT/UPDATE case_entries
```

### Timestamp Triggers
```sql
set_updated_at → BEFORE UPDATE (15+ tables)
set_program_goals_updated_at → BEFORE UPDATE program_goals
set_rotations_updated_at → BEFORE UPDATE rotations
```

## 14. INDEXES

### Performance Indexes
```sql
-- case_entries
idx_case_entries_tenant ON (tenant_id)
idx_case_entries_resident ON (resident_id)
idx_case_entries_status ON (status)
idx_case_entries_field_values GIN (field_values)
idx_case_entries_case_date BRIN (case_date)

-- audit_logs
idx_audit_logs_tenant ON (tenant_id)
idx_audit_logs_resource ON (resource_type, resource_id)
idx_audit_logs_created_at BRIN (created_at)

-- notifications
idx_notifications_user_read ON (user_id, read_at)
idx_notifications_tenant_created ON (tenant_id, created_at)

-- rotations
idx_rotations_tenant_resident ON (tenant_id, resident_id)
idx_rotations_start_date ON (start_date)

-- evaluation_forms
idx_evaluation_forms_tenant_resident ON (tenant_id, resident_id)
idx_evaluation_forms_form_type ON (form_type)

-- Full-text search
idx_case_templates_name_trgm GIN (name gin_trgm_ops)
idx_procedure_codes_desc_trgm GIN (description gin_trgm_ops)
```

## 15. MATERIALIZED VIEWS

### case_stats_by_specialty_mv
Aggregated case counts by specialty, status, and time period
- Refresh: Manual via `refresh_case_stats_mv()`
- Used by: Dashboard analytics

### benchmark_mv
Anonymized cross-tenant comparative analytics
- Refresh: Daily cron job
- Used by: Benchmarking reports

## 16. EXTENSIONS

```sql
CREATE EXTENSION pgcrypto;    -- gen_random_uuid(), encryption
CREATE EXTENSION pg_trgm;     -- Trigram search
CREATE EXTENSION pgtap;       -- Testing (test env only)
```

## 17. STORAGE BUCKETS

### case-attachments
- RLS-protected
- Max file size: 10MB per file
- Max total per tenant: defined in subscription plan
- Policies:
  - Tenant members: SELECT
  - Residents: INSERT (own entries)
  - Supervisors+: DELETE

## 18. SECURITY FEATURES

### Row-Level Security
- Enabled on all 59 tables
- FORCE ROW LEVEL SECURITY on sensitive tables
- Policies use SECURITY DEFINER helper functions

### Encryption
- API keys (ai_config.encrypted_api_key)
- Webhook secrets (tenant_webhooks.secret)
- SSO credentials (tenant_sso_configs.client_secret_encrypted)
- Payment gateway secrets
- Key versioning with rotation support

### PHI Protection
- Patient MRN hashing with tenant-specific salt
- PHI detection regex on field_values
- Audit log redaction
- De-identification mode support

### Audit Trail
- 20+ audit triggers
- Append-only policy on audit_logs
- IP address tracking
- Session ID tracking
- User agent capture

### Access Control
- MFA enforcement (optional per tenant)
- Rate limiting via check_rate_limit()
- Role transition authorization
- Platform admin logging

### Data Governance
- Configurable data retention
- Soft delete pattern (deleted_at)
- Consent management
- Write-once enforcement
- Lapsed tenant guards

### Search Path Security
- All SECURITY DEFINER functions use explicit schema
- search_path normalized in migrations

## 19. ENTERPRISE FEATURES

### Multi-Tenancy
- Institution → Tenant hierarchy
- Tenant isolation via RLS
- Cross-tenant analytics (anonymized)

### SSO Integration
- SAML 2.0 support
- OpenID Connect support
- JIT provisioning
- Role mapping

### SCIM Provisioning
- User provisioning API
- Token-based auth
- Audit logging

### Webhooks
- Event subscriptions
- Retry queue with exponential backoff
- Secret verification
- Delivery logging

### White Label
- Theme revisions
- Custom pages with versioning
- Multi-locale support
- Tenant-scoped and platform-scoped pages

### Offline Sync
- Conflict resolution
- Tombstone support
- Batch push/pull
- Last-write-wins strategy

### Data Modes
- Development mode (test data)
- Production mode (real PHI)
- Mode immutability
- Cross-mode isolation

### Platform Administration
- Cross-tenant access
- Access logging
- Time-limited access grants

### Compliance
- HIPAA audit trail
- PHI redaction
- Consent management
- Data retention policies
- Right to be forgotten (soft delete)

### Subscription Management
- Multiple plan types
- Usage-based billing
- Quota enforcement
- Grace period handling

### AI Features
- Per-resident quotas
- Token tracking
- Response caching
- Provider abstraction
- Atomic quota operations

## 20. DATA FLOW DIAGRAMS

### User Onboarding
```
1. User signs up → auth.users (Supabase Auth)
2. on_auth_user_created trigger → creates profile
3. Admin assigns tenant + role → updates profile
4. User logs in → JWT includes tenant_id, user_role
5. All queries filtered by get_tenant_id()
```

### Case Submission Flow
```
1. Resident creates case → case_entries (status='draft')
2. Auto-audit → audit_logs
3. PHI scan → scan_field_values_for_phi()
4. MRN hashing → hash_patient_mrn()
5. Resident submits → status='pending'
6. Creates approval_request
7. Supervisor approves → status='approved'
8. Triggers recalc_goal_progress()
9. Updates goal_progress.current_count
10. Checks milestone achievements
```

### Goal Progress Tracking
```
1. Director creates program_goal
2. Initializes goal_progress (current_count=0)
3. Case approved → recalc_goal_progress()
4. Counts approved cases matching goal criteria
5. Updates goal_progress.current_count
6. Dashboard shows progress
```

### Rotation & Evaluation
```
1. Admin creates rotation
2. Assigns resident + supervisor
3. During rotation: duty_periods tracking
4. Supervisor creates evaluation_forms
5. Links evidence: case_entries
6. Records milestones
7. Checks 4-week duty hour violations
```

### AI Query Flow
```
1. Resident enables AI (resident_ai_toggle.enabled=true)
2. Query submitted → check quota
3. Cache lookup → ai_response_cache
4. Cache hit → return cached response
5. Cache miss → call AI provider
6. consume_ai_quota() → atomic decrement
7. Log query → ai_query_logs
8. Cache response → ai_response_cache
```

### Webhook Delivery
```
1. Event occurs (e.g., case approved)
2. Lookup tenant_webhooks for event_type
3. Create tenant_webhook_deliveries
4. Attempt delivery → POST with secret
5. Success → mark delivered_at
6. Failure → webhook_retry_queue
7. Exponential backoff retries
8. Max attempts → mark failed
```

### Offline Sync
```
1. Mobile app collects changes offline
2. Batch pushed → sync_push_batch()
3. Conflict resolution (last-write-wins)
4. Server applies changes
5. Returns sync result with conflicts
6. Mobile app pulls → sync_pull_changes(last_sync)
7. Returns changed rows since last_sync
8. Mobile app reconciles
```

### Subscription Lifecycle
```
1. Tenant signs up → subscriptions (status='trialing')
2. Trial ends → status='active'
3. Stripe webhook → stripe_events
4. Process event → update subscription
5. Payment fails → status='past_due'
6. Grace period expires → status='unpaid'
7. Lapsed tenant guard blocks inserts
8. Payment succeeds → status='active'
```

### Data Retention
```
1. Admin sets tenant_settings.data_retention_days
2. Nightly cron → enforce_data_retention()
3. Soft deletes old records (sets deleted_at)
4. RLS policies filter WHERE deleted_at IS NULL
5. Manual purge after retention + grace period
```

---

**Generated:** 2026-09-16
**Migrations Analyzed:** 135 files
**Tables Documented:** 59
**Functions Documented:** 80+
**Triggers Documented:** 40+
**RLS Policies:** 150+
