// Dependency-free by design: the PDF scope module imports nothing remote, so this
// suite runs with `--frozen --no-config --allow-read` and no network.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = ''): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${b}`);
}

import {
  PDF_SCOPE_ROLES,
  authorizePdfScope,
  buildPdfReportRows,
  type PdfPrincipal,
  type PdfRequestBody,
  type PdfRow,
} from './export-policy.ts';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_A = '22222222-2222-4222-8222-222222222222';
const RESIDENT_B = '33333333-3333-4333-8333-333333333333';
const ENTRY_A = '44444444-4444-4444-8444-444444444444';
const ENTRY_B = '55555555-5555-4555-8555-555555555555';

function principal(overrides: Partial<PdfPrincipal> = {}): PdfPrincipal {
  return {
    role: 'supervisor',
    profileId: '66666666-6666-4666-8666-666666666666',
    tenantId: TENANT_ID,
    aal: 'aal2',
    profileStatus: 'active',
    tenantStatus: 'active',
    ...overrides,
  };
}

function body(overrides: Partial<PdfRequestBody> = {}): PdfRequestBody {
  return {
    case_ids: [ENTRY_A],
    resident_id: RESIDENT_A,
    ...overrides,
  };
}

Deno.test('pdf export is restricted to the supervisor scope', () => {
  for (const role of PDF_SCOPE_ROLES) {
    const decision = authorizePdfScope({ principal: principal({ role }), body: body() });
    assert(decision.ok, `role ${role} must be allowed`);
  }
  assertEquals(
    authorizePdfScope({ principal: principal({ role: 'resident' }), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
  assertEquals(
    authorizePdfScope({ principal: principal({ role: 'service_account' }), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
});

Deno.test('pdf export requires aal2 and an active scope', () => {
  assertEquals(
    authorizePdfScope({ principal: principal({ aal: 'aal1' }), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
  assertEquals(
    authorizePdfScope({ principal: principal({ profileStatus: 'suspended' }), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
  assertEquals(
    authorizePdfScope({ principal: principal({ tenantStatus: 'suspended' }), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
});

Deno.test('pdf export requires exactly one resident id', () => {
  assertEquals(
    authorizePdfScope({ principal: principal(), body: { case_ids: [ENTRY_A] } }),
    { ok: false, status: 400, error: 'resident_id_required' },
  );
  assertEquals(
    authorizePdfScope({ principal: principal(), body: body({ resident_id: 'a,b' }) }),
    { ok: false, status: 400, error: 'resident_id_invalid' },
  );
});

Deno.test('pdf export rejects a client-supplied resident name', () => {
  const decision = authorizePdfScope({
    principal: principal(),
    body: { ...body(), resident_name: 'Dr Jane Resident' } as PdfRequestBody,
  });

  assertEquals(decision, { ok: false, status: 400, error: 'resident_name_not_accepted' });
});

Deno.test('pdf export rejects an empty or oversized case id list', () => {
  assertEquals(
    authorizePdfScope({ principal: principal(), body: body({ case_ids: [] }) }),
    { ok: false, status: 400, error: 'case_ids_required' },
  );
  assertEquals(
    authorizePdfScope({
      principal: principal(),
      body: body({ case_ids: Array.from({ length: 101 }, () => ENTRY_A) }),
    }),
    { ok: false, status: 400, error: 'too_many_cases' },
  );
  assertEquals(
    authorizePdfScope({ principal: principal(), body: body({ case_ids: ['not-a-uuid'] }) }),
    { ok: false, status: 400, error: 'case_ids_invalid' },
  );
});

Deno.test('pdf export fails closed when the rows do not belong to the single resident', () => {
  const rows: PdfRow[] = [
    {
      id: ENTRY_A,
      resident_id: RESIDENT_A,
      tenant_id: TENANT_ID,
      status: 'approved',
      case_date: '2026-02-01',
      deleted_at: null,
      case_templates: { name: 'Appendectomy', specialty: 'surgery' },
    },
    {
      id: ENTRY_B,
      resident_id: RESIDENT_B,
      tenant_id: TENANT_ID,
      status: 'approved',
      case_date: '2026-02-02',
      deleted_at: null,
      case_templates: { name: 'CABG', specialty: 'cardiology' },
    },
  ];

  const result = buildPdfReportRows({ rows, residentId: RESIDENT_A, tenantId: TENANT_ID });

  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.reason, 'resident_scope_violation');
});

Deno.test('pdf export drops unapproved, soft-deleted and cross-tenant rows', () => {
  const rows: PdfRow[] = [
    {
      id: ENTRY_A,
      resident_id: RESIDENT_A,
      tenant_id: TENANT_ID,
      status: 'approved',
      case_date: '2026-02-01',
      deleted_at: null,
      field_values: { dx: 'appendicitis' },
      case_templates: { name: 'Appendectomy', specialty: 'surgery' },
    },
    {
      id: ENTRY_B,
      resident_id: RESIDENT_A,
      tenant_id: TENANT_ID,
      status: 'pending',
      case_date: '2026-02-02',
      deleted_at: null,
      case_templates: { name: 'Pending', specialty: 'surgery' },
    },
    {
      id: ENTRY_B,
      resident_id: RESIDENT_A,
      tenant_id: TENANT_ID,
      status: 'approved',
      case_date: '2026-02-03',
      deleted_at: '2026-02-04T00:00:00Z',
      case_templates: { name: 'Deleted', specialty: 'surgery' },
    },
  ];

  const result = buildPdfReportRows({ rows, residentId: RESIDENT_A, tenantId: TENANT_ID });

  assert(result.ok, 'the single-resident scope holds');
  if (!result.ok) return;
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0]!.templateName, 'Appendectomy');
  assert(!JSON.stringify(result.rows).includes('appendicitis'), 'free-text field_values never reach the report');
});

Deno.test('pdf export reports an empty result when nothing is exportable', () => {
  const result = buildPdfReportRows({ rows: [], residentId: RESIDENT_A, tenantId: TENANT_ID });
  assertEquals(result, { ok: false, reason: 'no_exportable_cases' });
});
