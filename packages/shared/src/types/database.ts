export type TenantType = 'individual' | 'institution';
export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
export type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  tier: 'free' | 'premium' | 'enterprise';
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  institution_id: string | null;
  name: string;
  slug: string;
  tenant_type: TenantType;
  plan_id: string | null;
  settings: Record<string, unknown>;
  region: string;
  data_retention_days: number;
  consent_required: boolean;
  compliance_frameworks: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ComplianceConfiguration {
  region: string;
  data_retention_days: number;
  consent_required: boolean;
  compliance_frameworks: string[];
}

export interface Profile {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  full_name: string;
  specialty: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CaseTemplate {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
}

export interface TemplateFavorite {
  user_id: string;
  template_id: string;
  created_at: string;
}

export interface DutyPeriod {
  id: string;
  tenant_id: string;
  resident_id: string;
  shift_date: string;
  hours_worked: number;
  shift_type: 'call' | 'clinic' | 'vacation' | 'weekend' | 'regular';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseEntry {
  id: string;
  tenant_id: string;
  resident_id: string;
  template_id: string;
  patient_mrn: string | null;
  patient_dob: string | null;
  patient_age_years: number | null;
  patient_hash: string | null;
  case_date: string;
  field_values: Record<string, unknown>;
  status: CaseStatus;
  accreditation_mappings: AccreditationMapping[];
  is_deidentified: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type FrameworkType = 'acgme' | 'scfhs' | 'gmc' | 'canmeds' | 'custom';

export interface AccreditationMapping {
  framework_id: string;
  milestone_code: string;
  competency_area: string;
  procedure_role?: 'observed' | 'assisted' | 'performed' | 'supervised';
}

export interface AccreditationMilestone {
  code: string;
  description: string;
  competency_area: string;
  target_minimum: number;
  specialty?: string;
}

export interface AccreditationFramework {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  framework_type: FrameworkType;
  milestones: AccreditationMilestone[];
  created_at: string;
  updated_at: string;
}

export interface AttachmentSignature {
  id: string;
  tenant_id: string;
  attachment_id: string;
  resident_id: string;
  signature_hash: string;
  verification_method: 'camera_hash' | 'manual_hash' | 'device_signature';
  verified_at: string;
  created_at: string;
}

export interface InstitutionBilling {
  id: string;
  tenant_id: string;
  billing_period_start: string;
  billing_period_end: string;
  active_residents: number;
  base_amount: number;
  per_resident_fee: number;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'canceled';
  invoice_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseAttachment {
  id: string;
  entry_id: string;
  tenant_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  file_type: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface ApprovalRequest {
  id: string;
  entry_id: string;
  tenant_id: string;
  supervisor_id: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, unknown> | null;
  ip_address: string;
  created_at: string;
}

export interface AIConfig {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  // API key managed server-side only
  has_key?: boolean;
  endpoint_url: string | null;
  is_active: boolean;
}

export interface AIQueryLog {
  id: string;
  tenant_id: string;
  resident_id: string;
  query: string;
  response: string | null;
  tokens_used: number | null;
  disclaimer_rendered: boolean;
  response_format: 'text' | 'stream';
  safety_flags: string[];
  created_at: string;
}

export interface ProgramGoal {
  id: string;
  tenant_id: string;
  director_id: string;
  resident_id: string;
  title: string;
  target_count: number;
  specialty: string | null;
  deadline: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: TenantType;
  max_residents: number | null;
  stripe_price_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  gateway_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StripeEvent {
  id: string;
  stripe_event_id: string;
  type: string;
  status: string;
  created_at: string;
  processed_at: string | null;
}

export interface Payment {
  id: string;
  tenant_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stripe_event_id: string | null;
  created_at: string;
}

export interface OneTimePurchase {
  id: string;
  tenant_id: string;
  resident_id: string;
  purchase_type: string;
  amount: number;
  status: PaymentStatus;
  created_at: string;
}

export interface ResidentAIToggle {
  id: string;
  tenant_id: string;
  resident_id: string;
  enabled: boolean;
  quota_limit: number | null;
  quota_used: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentGatewayConfig {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  // Secret key and webhook secret managed server-side only
  has_secret_key?: boolean;
  has_webhook_secret?: boolean;
  endpoint_url: string | null;
  is_active: boolean;
}
