import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { webcrypto } from 'node:crypto';

// jsdom's `crypto` shim has no SubtleCrypto, so the HMAC signature step would
// throw and the dispatch would report a network failure instead of exercising
// the payload projection.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Shared mock client that tests can configure
const mockClient = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => mockClient,
}));

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});

const originalAllowedHosts = process.env.OUTBOUND_ALLOWED_HOSTS;
const nativeCrypto = globalThis.crypto;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OUTBOUND_ALLOWED_HOSTS = 'example.com';
  mockClient.from = vi.fn();
  mockClient.rpc = vi.fn().mockResolvedValue({ data: 'secret-1', error: null });

  // Provide minimal crypto.subtle mock using vi.stubGlobal (works even with readonly getters)
  vi.stubGlobal('crypto', {
    subtle: {
      importKey: vi.fn().mockResolvedValue('mock-key'),
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer),
    },
    randomUUID: vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000000'),
  });
});

afterEach(() => {
  if (originalAllowedHosts === undefined) delete process.env.OUTBOUND_ALLOWED_HOSTS;
  else process.env.OUTBOUND_ALLOWED_HOSTS = originalAllowedHosts;
  vi.unstubAllGlobals();
});

// We import after the mock is set up
const { dispatchWebhookEvent, testWebhookEndpoint, buildWebhookEventBody, isVendorPayloadPolicyApproved } = await import('../webhooks');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function makeQueryMock(result: { data: unknown; error: null | Error }) {
  return vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(result),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'delivery-1' }, error: null }),
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });
}

/** Every dispatchable vendor row must declare the approved payload policy. */
function vendorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh-1',
    url: 'https://example.com/hook1',
    events: ['case.submitted', 'case.approved'],
    payload_policy: 'metadata_only',
    ...overrides,
  };
}

describe('buildWebhookEventBody', () => {
  it('emits only opaque event metadata', () => {
    const body = JSON.parse(
      buildWebhookEventBody({
        tenant_id: TENANT_ID,
        event_type: 'case.approved',
        event_id: ENTRY_ID,
        data: { entry_id: ENTRY_ID, actor_id: ACTOR_ID, status: 'approved' },
      }),
    );

    expect(body).toEqual({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID, actor_id: ACTOR_ID, status: 'approved' },
    });
  });

  it('drops free-text approval comments', () => {
    const body = buildWebhookEventBody({
      tenant_id: TENANT_ID,
      event_type: 'case.rejected',
      event_id: ENTRY_ID,
      data: {
        entry_id: ENTRY_ID,
        comment: 'Dr Smith rejected: documentation was inadequate for this patient',
        reason: 'patient identifiers were pasted into the note',
      },
    });

    expect(body).not.toContain('Dr Smith');
    expect(body).not.toContain('inadequate');
    expect(body).not.toContain('patient identifiers');
    expect(JSON.parse(body).data).toEqual({ entry_id: ENTRY_ID });
  });

  it('drops resident and reviewer names, case details and field_values', () => {
    const body = buildWebhookEventBody({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: {
        entry_id: ENTRY_ID,
        resident_name: 'Dr Jane Resident',
        reviewer_name: 'Dr John Reviewer',
        full_name: 'Dr Jane Resident',
        patient_mrn: 'MRN-4242',
        patient_dob: '1990-01-01',
        field_values: { dx: 'appendicitis' },
        case_details: 'night case on the wards',
      },
    });

    for (const forbidden of [
      'Dr Jane',
      'Dr John',
      'MRN-4242',
      '1990-01-01',
      'appendicitis',
      'night case',
    ]) {
      expect(body).not.toContain(forbidden);
    }
    expect(JSON.parse(body).data).toEqual({ entry_id: ENTRY_ID });
  });

  it('drops a non-opaque value even under an allowlisted key', () => {
    const body = buildWebhookEventBody({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: 'a free text entry description', case_count: 4 },
    });

    expect(JSON.parse(body).data).toEqual({ case_count: 4 });
  });

  it('refuses to serialize a missing tenant or event id', () => {
    expect(() =>
      buildWebhookEventBody({ tenant_id: '', event_type: 'case.approved', event_id: ENTRY_ID, data: {} }),
    ).toThrow();
    expect(() =>
      buildWebhookEventBody({ tenant_id: TENANT_ID, event_type: 'case.approved', event_id: '', data: {} }),
    ).toThrow();
  });

  it('is stable for the same input so the HMAC signature is reproducible', () => {
    const input = {
      tenant_id: TENANT_ID,
      event_type: 'case.approved' as const,
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID, status: 'approved' },
    };
    expect(buildWebhookEventBody(input)).toBe(buildWebhookEventBody(input));
  });
});

describe('isVendorPayloadPolicyApproved', () => {
  it('approves only the metadata-only policy', () => {
    expect(isVendorPayloadPolicyApproved('metadata_only')).toBe(true);
    expect(isVendorPayloadPolicyApproved('phi')).toBe(false);
    expect(isVendorPayloadPolicyApproved(undefined)).toBe(false);
    expect(isVendorPayloadPolicyApproved(null)).toBe(false);
  });
});

describe('dispatchWebhookEvent', () => {
  it('returns empty array when tenant_id is missing', async () => {
    const result = await dispatchWebhookEvent({
      tenant_id: '',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: {},
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when no webhooks match', async () => {
    mockClient.from = makeQueryMock({ data: [], error: null });

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: { entry_id: 'entry-1' },
    });

    expect(result).toEqual([]);
  });

  it('filters webhooks by event type and dispatches to matching ones', async () => {
    const mockWebhooks = [
      vendorRow({ id: 'wh-1', events: ['case.submitted', 'case.approved'] }),
      vendorRow({ id: 'wh-2', url: 'https://example.com/hook2', events: ['case.approved'] }),
    ];

    mockClient.from = makeQueryMock({ data: mockWebhooks, error: null });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue('OK'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: { entry_id: 'entry-1' },
    });

    // Should only dispatch to wh-1 (matches case.submitted)
    expect(result).toHaveLength(1);
    expect(result[0].webhook_id).toBe('wh-1');

    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toBe('https://example.com/hook1');

    vi.unstubAllGlobals();
  });

  it('sends the opaque projection, never a free-text approval comment', async () => {
    mockClient.from = makeQueryMock({ data: [vendorRow()], error: null });
    const mockFetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await dispatchWebhookEvent({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID, actor_id: ACTOR_ID, comment: 'Dr Smith approved this case' },
    });

    const body = mockFetch.mock.calls[0]![1].body as string;
    expect(JSON.parse(body).data).toEqual({ entry_id: ENTRY_ID, actor_id: ACTOR_ID });
    expect(body).not.toContain('Dr Smith');
  });

  it('fails closed and omits the body for a vendor without an approved policy', async () => {
    mockClient.from = makeQueryMock({ data: [vendorRow({ payload_policy: 'phi' })], error: null });
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID },
    });

    expect(result).toEqual([{ webhook_id: 'wh-1', ok: false, status: 0 }]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails closed for a legacy row that has no policy at all', async () => {
    mockClient.from = makeQueryMock({
      data: [{ id: 'wh-1', url: 'https://example.com/hook1', events: ['case.approved'] }],
      error: null,
    });
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID },
    });

    expect(result[0]!.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('enqueues a durable retry when a delivery fails', async () => {
    mockClient.from = makeQueryMock({ data: [vendorRow()], error: null });
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: TENANT_ID,
      event_type: 'case.approved',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID },
    });

    expect(result[0]!.ok).toBe(false);
    const tables = (mockClient.from.mock.calls as unknown[][]).map((call) => call[0]);
    expect(tables).toContain('tenant_webhook_deliveries');
    expect(tables).toContain('webhook_retry_queue');
  });

  it('signs with the service-decrypted secret, not a stored placeholder', async () => {
    const secret = 'decrypted-service-secret';
    mockClient.from = makeQueryMock({ data: [vendorRow({ events: ['case.submitted'] })], error: null });
    mockClient.rpc.mockResolvedValue({ data: secret, error: null });
    vi.stubGlobal('crypto', nativeCrypto);
    const mockFetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await dispatchWebhookEvent({
      tenant_id: TENANT_ID,
      event_type: 'case.submitted',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID },
    });

    expect(mockClient.rpc).toHaveBeenCalledWith('get_tenant_webhook_secret', {
      p_webhook_id: 'wh-1',
    });
    const body = JSON.stringify({
      tenant_id: TENANT_ID,
      event_type: 'case.submitted',
      event_id: ENTRY_ID,
      data: { entry_id: ENTRY_ID },
    });
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['X-E-Logbook-Signature']).toBe(`sha256=${expected}`);
  });

  it.each([
    ['[ENCRYPTED]', null],
    [' [ENCRYPTED] ', null],
    [null, new Error('webhook encryption key is not configured')],
  ])('fails closed when the trusted secret RPC returns %s', async (secret, error) => {
    mockClient.from = makeQueryMock({ data: [vendorRow()], error: null });
    mockClient.rpc.mockResolvedValue({ data: secret, error });
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: {},
    });

    expect(result).toEqual([{ webhook_id: 'wh-1', ok: false, status: 0 }]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles fetch failure gracefully', async () => {
    mockClient.from = makeQueryMock({ data: [vendorRow({ events: ['case.approved'] })], error: null });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.approved',
      event_id: 'evt-1',
      data: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0].ok).toBe(false);
    expect(result[0].status).toBe(0);

    vi.unstubAllGlobals();
  });

  it('returns empty array when webhook query errors', async () => {
    mockClient.from = makeQueryMock({ data: null, error: new Error('DB error') });

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: {},
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when events field is null (not an array)', async () => {
    mockClient.from = makeQueryMock({
      data: [{ ...vendorRow({ id: 'wh-3', url: 'https://example.com/hook3' }), events: null }],
      error: null,
    });

    const result = await dispatchWebhookEvent({
      tenant_id: 'tenant-1',
      event_type: 'case.submitted',
      event_id: 'evt-1',
      data: {},
    });

    expect(result).toEqual([]);
  });
});

describe('testWebhookEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success response when endpoint is reachable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue('OK'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testWebhookEndpoint(
      'https://example.com/hook-test',
      'test-secret',
      'tenant-1',
    );

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);

    // Verify the fetch was called with expected headers
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-E-Logbook-Event']).toBe('test.ping');
    expect(opts.headers['X-E-Logbook-Signature']).toMatch(/^sha256=/);

    vi.unstubAllGlobals();
  });

  it('handles network failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await testWebhookEndpoint(
      'https://example.com/hook-fail',
      'secret',
      'tenant-1',
    );

    expect(result.ok).toBe(false);
    expect(result.body).toBe('');

    vi.unstubAllGlobals();
  });

  it('handles non-200 status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      }),
    );

    const result = await testWebhookEndpoint(
      'https://example.com/hook-500',
      'secret',
      'tenant-1',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);

    vi.unstubAllGlobals();
  });

  it('handles empty/error response body from fetch text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: vi.fn().mockRejectedValue(new Error('Body read error')),
      }),
    );

    const result = await testWebhookEndpoint(
      'https://example.com/hook-empty',
      'secret',
      'tenant-1',
    );

    expect(result.status).toBe(200);
    expect(result.ok).toBe(false);
    expect(result.body).toBe('');

    vi.unstubAllGlobals();
  });
});
