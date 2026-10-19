import { describe, expect, it, vi, afterEach } from 'vitest';
import { resendSend } from '../resend';

const API_KEY = 're_test_key';
const FROM = 'E-Logbook <no-reply@example.test>';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status }) as unknown as Response;
}

function headerOf(fetchMock: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return call[1].headers as Record<string, string>;
}

describe('resendSend idempotency', () => {
  it('sends the caller key as the provider dedup key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'msg-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await resendSend(API_KEY, FROM, {
      to: 'resident@example.test',
      subject: 's',
      html: 'h',
      idempotencyKey: 'queue-row-42',
    });

    expect(headerOf(fetchMock)['Idempotency-Key']).toBe('queue-row-42');
  });

  it('omits the header rather than sending an empty key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'msg-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await resendSend(API_KEY, FROM, { to: 'resident@example.test', subject: 's', html: 'h' });

    expect(headerOf(fetchMock)['Idempotency-Key']).toBeUndefined();
  });

  it('refuses a key that could not be a provider dedup key', async () => {
    // A key the provider would accept verbatim is a key we did not choose, so
    // it is dropped rather than forwarded.
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'msg-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await resendSend(API_KEY, FROM, {
      to: 'resident@example.test',
      subject: 's',
      html: 'h',
      idempotencyKey: 'has spaces and/slashes',
    });

    expect(headerOf(fetchMock)['Idempotency-Key']).toBeUndefined();
  });

  it('marks a transport error as ambiguous rather than a clean failure', async () => {
    // The request may have reached the provider. Reporting this as a definitive
    // failure is what makes a caller retry and double-send.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up');
    }));

    await expect(
      resendSend(API_KEY, FROM, { to: 'resident@example.test', subject: 's', html: 'h' }),
    ).rejects.toMatchObject({ code: 'resend_transport_error' });
  });
});
