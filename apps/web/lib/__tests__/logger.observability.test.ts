import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logger } from '../logger';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const sensitiveValues = [
  'patient@example.test',
  'MRN-9A8B7C',
  '1986-07-08',
  'Bearer logger-secret',
  'session=logger-cookie',
  'provider-secret',
];

function expectNoSensitiveValues(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of sensitiveValues) expect(serialized).not.toContain(secret);
}

describe('logger production observability boundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_ENDPOINT', '');
    vi.stubEnv('LOG_API_KEY', '');
    vi.stubEnv('LOG_EXTERNAL_ENABLED', '');
    vi.stubEnv('LOG_ALLOWED_HOSTS', '');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.captureMessage).mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('logs only sanitized structured context and a stable event ID', () => {
    const error = new Error(`failure for patient@example.test with Bearer logger-secret`);
    logger.error('provider failed', error, {
      status: 502,
      eventId: 'caller-event-id',
      email: 'patient@example.test',
      patient_mrn: 'MRN-9A8B7C',
      authorization: 'Bearer logger-secret',
      request: { body: { email: 'patient@example.test' } },
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expectNoSensitiveValues(entry);
    expect(entry.eventId).toMatch(/^evt_/);
    expect(entry.status).toBe(502);
    expect(entry.request).toEqual(expect.objectContaining({ body: '[REDACTED]' }));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const sentryCall = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(sentryCall[0]).toBe(entry.eventId);
    expectNoSensitiveValues(sentryCall[1]);
  });

  it('does not send LOG_ENDPOINT output unless explicitly enabled and allowlisted', async () => {
    process.env.LOG_ENDPOINT = 'https://logs.example.test/ingest';
    logger.warn('external logging disabled');

    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.LOG_EXTERNAL_ENABLED = 'true';
    process.env.LOG_ALLOWED_HOSTS = 'logs.example.test';
    logger.warn('external logging enabled', { status: 202, token: 'provider-secret' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe('https://logs.example.test/ingest');
    expectNoSensitiveValues(request[1].body);
  });

  it('does not send to a non-allowlisted endpoint', async () => {
    process.env.LOG_ENDPOINT = 'https://unapproved.example.test/ingest';
    process.env.LOG_EXTERNAL_ENABLED = 'true';
    process.env.LOG_ALLOWED_HOSTS = 'logs.example.test';

    logger.warn('blocked external logging');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
