// Dependency-free by design: the export policy module imports nothing remote, so
// this suite runs with `--frozen --no-config --allow-read` and no network.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = ''): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${b}`);
}

import {
  WEBADS_EXPORT_ROLES,
  authorizeWebadsExport,
  buildWebadsExportQuerySpec,
  buildWebadsXml,
  projectWebadsEntries,
  type WebadsPrincipal,
  type WebadsRequestBody,
  type WebadsVendorPolicy,
} from './export-policy.ts';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_A = '22222222-2222-4222-8222-222222222222';
const RESIDENT_B = '33333333-3333-4333-8333-333333333333';
const ENTRY_A = '44444444-4444-4444-8444-444444444444';
const ENTRY_B = '55555555-5555-4555-8555-555555555555';

function principal(overrides: Partial<WebadsPrincipal> = {}): WebadsPrincipal {
  return {
    role: 'director',
    profileId: '66666666-6666-4666-8666-666666666666',
    tenantId: TENANT_ID,
    aal: 'aal2',
    profileStatus: 'active',
    tenantStatus: 'active',
    ...overrides,
  };
}

function approvedPolicy(overrides: Partial<WebadsVendorPolicy> = {}): WebadsVendorPolicy {
  return { vendorEnabled: true, approvedPolicy: 'metadata_only', ...overrides };
}

function body(overrides: Partial<WebadsRequestBody> = {}): WebadsRequestBody {
  return {
    tenant_id: TENANT_ID,
    resident_ids: [RESIDENT_A, RESIDENT_B],
    deidentified_confirmed: true,
    ...overrides,
  };
}

Deno.test('webads export is denied by default when no vendor is configured', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: { vendorEnabled: false, approvedPolicy: null },
    body: body(),
  });

  assertEquals(decision, { ok: false, status: 501, error: 'external_export_not_enabled' });
});

Deno.test('webads export is denied when the vendor policy is not approved', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: { vendorEnabled: true, approvedPolicy: null },
    body: body(),
  });

  assertEquals(decision, { ok: false, status: 403, error: 'vendor_phi_policy_required' });
});

Deno.test('webads export is denied for an unapproved vendor payload policy', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: { vendorEnabled: true, approvedPolicy: 'phi' as unknown as 'metadata_only' },
    body: body(),
  });

  assertEquals(decision, { ok: false, status: 403, error: 'vendor_phi_policy_required' });
});

Deno.test('webads export requires an explicit de-identified confirmation', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: approvedPolicy(),
    body: body({ deidentified_confirmed: false }),
  });

  assertEquals(decision, { ok: false, status: 403, error: 'deidentified_confirmation_required' });
});

Deno.test('webads export requires aal2', () => {
  const decision = authorizeWebadsExport({
    principal: principal({ aal: 'aal1' }),
    policy: approvedPolicy(),
    body: body(),
  });

  assertEquals(decision, { ok: false, status: 403, error: 'forbidden' });
});

Deno.test('webads export requires an active profile and tenant', () => {
  assertEquals(
    authorizeWebadsExport({ principal: principal({ profileStatus: 'suspended' }), policy: approvedPolicy(), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
  assertEquals(
    authorizeWebadsExport({ principal: principal({ tenantStatus: 'suspended' }), policy: approvedPolicy(), body: body() }),
    { ok: false, status: 403, error: 'forbidden' },
  );
});

Deno.test('webads export rejects roles outside the privileged set', () => {
  for (const role of ['resident', 'supervisor', 'service_account', '']) {
    const decision = authorizeWebadsExport({
      principal: principal({ role }),
      policy: approvedPolicy(),
      body: body(),
    });
    assertEquals(decision, { ok: false, status: 403, error: 'forbidden' }, `role ${role}`);
  }
  for (const role of WEBADS_EXPORT_ROLES) {
    const decision = authorizeWebadsExport({ principal: principal({ role }), policy: approvedPolicy(), body: body() });
    assert(decision.ok, `role ${role} must be allowed`);
  }
});

Deno.test('webads export rejects a cross-tenant body', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: approvedPolicy(),
    body: body({ tenant_id: '77777777-7777-4777-8777-777777777777' }),
  });

  assertEquals(decision, { ok: false, status: 403, error: 'tenant_mismatch' });
});

Deno.test('webads export rejects malformed resident id lists', () => {
  assertEquals(
    authorizeWebadsExport({ principal: principal(), policy: approvedPolicy(), body: body({ resident_ids: [] }) }),
    { ok: false, status: 400, error: 'resident_ids_required' },
  );
  assertEquals(
    authorizeWebadsExport({ principal: principal(), policy: approvedPolicy(), body: body({ resident_ids: ['a,b'] }) }),
    { ok: false, status: 400, error: 'resident_ids_invalid' },
  );
  assertEquals(
    authorizeWebadsExport({
      principal: principal(),
      policy: approvedPolicy(),
      body: body({ resident_ids: Array.from({ length: 501 }, () => RESIDENT_A) }),
    }),
    { ok: false, status: 400, error: 'too_many_residents' },
  );
});

Deno.test('webads export rejects a non ISO date range', () => {
  const decision = authorizeWebadsExport({
    principal: principal(),
    policy: approvedPolicy(),
    body: body({ date_from: '01/01/2026' }),
  });

  assertEquals(decision, { ok: false, status: 400, error: 'date_range_invalid' });
});

Deno.test('webads export query is approved-only and never selects PHI columns', () => {
  const spec = buildWebadsExportQuerySpec({
    tenantId: TENANT_ID,
    residentIds: [RESIDENT_A],
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
  });

  assertEquals(spec.status, ['approved'], 'only approved cases are exportable');
  assert(!spec.status.includes('pending'), 'pending cases are never exportable');
  assertEquals(spec.onlyNotDeleted, true, 'soft-deleted cases are never exportable');
  assertEquals(spec.limit, 5000, 'the row limit is bounded');
  assert(!spec.select.includes('patient_mrn'), 'MRN is not selected');
  assert(!spec.select.includes('patient_dob'), 'DOB is not selected');
  assert(!spec.select.includes('field_values'), 'free-text field_values is not selected');
  assert(!spec.select.includes('full_name'), 'resident names are not selected');
});

Deno.test('webads projection drops resident names, MRNs, DOBs and free text', () => {
  const entries = projectWebadsEntries([
    {
      id: ENTRY_A,
      resident_id: RESIDENT_A,
      case_date: '2026-02-01',
      status: 'approved',
      created_at: '2026-02-01T10:00:00Z',
      updated_at: '2026-02-02T10:00:00Z',
      patient_mrn: 'MRN-4242',
      patient_dob: '1990-01-01',
      field_values: { dx: 'appendicitis' },
      profiles: { id: RESIDENT_A, full_name: 'Dr Jane Resident', specialty: 'surgery' },
      case_templates: { id: '88888888-8888-4888-8888-888888888888', name: 'Appendectomy', specialty: 'surgery' },
    },
    {
      id: ENTRY_B,
      resident_id: RESIDENT_B,
      case_date: '2026-02-03',
      status: 'approved',
      created_at: '2026-02-03T10:00:00Z',
      updated_at: '2026-02-03T10:00:00Z',
      profiles: { id: RESIDENT_B, full_name: 'Dr John Resident', specialty: 'cardiology' },
      case_templates: { id: '99999999-9999-4999-8999-999999999999', name: 'CABG', specialty: 'cardiology' },
    },
  ]);

  assertEquals(entries.length, 2);
  const serialized = JSON.stringify(entries);
  for (const forbidden of ['Jane', 'John', 'MRN-4242', '1990-01-01', 'appendicitis', RESIDENT_A, RESIDENT_B]) {
    assert(!serialized.includes(forbidden), `projection must not contain ${forbidden}`);
  }
  assertEquals(entries[0]!.residentRef, 'R1');
  assertEquals(entries[1]!.residentRef, 'R2');
  assertEquals(entries[0]!.templateName, 'Appendectomy');
});

Deno.test('webads xml carries the opaque projection and no identifier elements', () => {
  const xml = buildWebadsXml({
    tenantId: TENANT_ID,
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
    generatedAt: '2026-07-01T00:00:00.000Z',
    entries: projectWebadsEntries([
      {
        id: ENTRY_A,
        resident_id: RESIDENT_A,
        case_date: '2026-02-01',
        status: 'approved',
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-02T10:00:00Z',
        patient_mrn: 'MRN-4242',
        patient_dob: '1990-01-01',
        field_values: { dx: 'appendicitis' },
        profiles: { id: RESIDENT_A, full_name: 'Dr Jane Resident' },
        case_templates: { name: 'Appendectomy', specialty: 'surgery' },
      },
    ]),
  });

  for (const forbidden of ['Jane', 'MRN-4242', '1990-01-01', 'appendicitis', RESIDENT_A]) {
    assert(!xml.includes(forbidden), `xml must not contain ${forbidden}`);
  }
  for (const forbiddenElement of ['<FullName>', '<MRN>', '<DOB>', '<FieldValues>', '<Field ', '<ResidentId>']) {
    assert(!xml.includes(forbiddenElement), `xml must not contain ${forbiddenElement}`);
  }
  assert(xml.includes('<ResidentRef>R1</ResidentRef>'), 'xml exposes only the opaque resident surrogate');
  assert(xml.includes('<PayloadPolicy>metadata_only</PayloadPolicy>'), 'xml declares the approved payload policy');
  assert(xml.includes(`<TenantId>${TENANT_ID}</TenantId>`), 'xml records the exporting tenant');
});

Deno.test('webads xml escapes injected template text', () => {
  const xml = buildWebadsXml({
    tenantId: TENANT_ID,
    dateFrom: null,
    dateTo: null,
    generatedAt: '2026-07-01T00:00:00.000Z',
    entries: [
      {
        entryId: ENTRY_A,
        residentRef: 'R1',
        caseDate: '2026-02-01',
        status: 'approved',
        templateId: '88888888-8888-4888-8888-888888888888',
        templateName: '</TemplateName><FullName>Dr Jane</FullName>',
        specialty: 'surgery',
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-02-02T10:00:00Z',
      },
    ],
  });

  assert(!xml.includes('<FullName>Dr Jane</FullName>'), 'injected elements are escaped');
  assert(xml.includes('&lt;FullName&gt;Dr Jane'), 'injected markup is escaped as text');
});
