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

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
  order?: number;
  validation?: FieldValidation;
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

export interface Payment {
  id: string;
  tenant_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stripe_event_id: string | null;
  created_at: string;
}
