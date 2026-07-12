import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock client that tests can configure
const mockClient = {
  from: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => mockClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.from = vi.fn();

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
  vi.unstubAllGlobals();
});

// We import after the mock is set up
const { dispatchWebhookEvent, testWebhookEndpoint } = await import('../webhooks');

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
      {
        id: 'wh-1',
        url: 'https://example.com/hook1',
        secret: 'secret-1',
        events: ['case.submitted', 'case.approved'],
      },
      {
        id: 'wh-2',
        url: 'https://example.com/hook2',
        secret: 'secret-2',
        events: ['case.approved'], // does NOT match case.submitted
      },
    ];

    mockClient.from = makeQueryMock({ data: mockWebhooks, error: null });

    // Mock fetch to succeed
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

    // fetch should have been called once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toBe('https://example.com/hook1');

    vi.unstubAllGlobals();
  });

  it('handles fetch failure gracefully', async () => {
    mockClient.from = makeQueryMock({
      data: [
        {
          id: 'wh-1',
          url: 'https://example.com/hook1',
          secret: 'secret-1',
          events: ['case.approved'],
        },
      ],
      error: null,
    });

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
      data: [
        {
          id: 'wh-3',
          url: 'https://example.com/hook3',
          secret: 'secret-3',
          events: null,
        },
      ],
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
    expect(result.body).toContain('Network error');

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
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockRejectedValue(new Error('Body read error')),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testWebhookEndpoint(
      'https://example.com/hook-empty',
      'secret',
      'tenant-1',
    );

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.body).toBe('');

    vi.unstubAllGlobals();
  });
});
