export type TenantType = 'individual' | 'institution';
export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
export type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  tier: string;
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
  created_at: string;
  updated_at: string;
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
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
}

export interface CaseEntry {
  id: string;
  tenant_id: string;
  resident_id: string;
  template_id: string;
  patient_mrn: string;
  patient_dob: string;
  case_date: string;
  field_values: Record<string, unknown>;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
}

export interface CaseAttachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  uploaded_at: string;
}

export interface ApprovalRequest {
  id: string;
  entry_id: string;
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
  encrypted_api_key: string;
  endpoint_url: string | null;
  is_active: boolean;
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
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: TenantType;
  max_residents: number | null;
}

export interface PaymentGatewayConfig {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  encrypted_secret_key: string;
  encrypted_webhook_secret: string;
  endpoint_url: string | null;
  is_active: boolean;
}
