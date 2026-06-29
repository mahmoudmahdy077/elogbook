export function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    tenant_id: 't-1',
    user_id: 'u-1',
    role: 'resident',
    full_name: 'Test Resident',
    specialty: 'general',
    ...overrides,
  };
}

export function makeCaseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    tenant_id: 't-1',
    resident_id: 'p-1',
    template_id: 'tmpl-1',
    status: 'draft',
    case_date: '2026-01-01',
    is_deidentified: true,
    field_values: { role: 'performed' },
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    institution_id: 'i-1',
    tenant_type: 'individual',
    name: 'Test Tenant',
    slug: 'test',
    plan_id: 'plan-free',
    ...overrides,
  };
}

export function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tmpl-1',
    tenant_id: 't-1',
    specialty: 'general',
    name: 'Test Template',
    fields: [{ key: 'role', label: 'Role', type: 'select' }],
    required_fields: ['role'],
    ...overrides,
  };
}
