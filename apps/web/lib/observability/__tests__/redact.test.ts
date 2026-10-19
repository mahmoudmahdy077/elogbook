import { describe, expect, it } from 'vitest';
import {
  createEventId,
  redact,
  redactSentryEvent,
  safeStringify,
} from '../redact';

const secrets = [
  'jane.patient@example.test',
  'MRN-7F3A9C',
  '1987-04-12',
  'Jane',
  'Jane Patient',
  'Bearer top-secret-token',
  'session=private-cookie',
  'sk-provider-secret',
  'query-secret-value',
];

function expectNoSecrets(value: unknown): void {
  const serialized = safeStringify(value);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe('observability redaction', () => {
  it('preserves top-level operational messages while redacting nested provider messages', () => {
    expect(redact({ message: 'hello debug' }, { mode: 'allowlist' })).toEqual({ message: 'hello debug' });
    expect(redact({ message: 'hello debug' }, { mode: 'compat' })).toEqual({ message: 'hello debug' });
    expect(redact({ providerResponse: { message: 'Jane Patient' } })).toEqual({
      providerResponse: { message: '[REDACTED]' },
    });
  });

  it('recursively redacts nested objects and arrays without exposing values', () => {
    const value = {
      safe: {
        level: 'warn',
        timestamp: '2026-09-24T00:00:00.000Z',
        nested: [{ count: 2 }, { count: 3 }],
      },
      patientMRN: 'MRN-7F3A9C',
      patient_dob: '1987-04-12',
      email: 'jane.patient@example.test',
      name: 'Jane Patient',
      field_values: { note: 'private clinical note' },
      nested: [{ authorization: 'Bearer top-secret-token' }],
    };

    const result = redact(value);
    const serialized = safeStringify(result);

    expect(serialized).not.toContain('MRN-7F3A9C');
    expect(serialized).not.toContain('1987-04-12');
    expect(serialized).not.toContain('jane.patient@example.test');
    expect(serialized).not.toContain('Jane Patient');
    expect(serialized).not.toContain('private clinical note');
    expect(result).toEqual(expect.objectContaining({ safe: { level: 'warn', timestamp: '2026-09-24T00:00:00.000Z', nested: [{ count: 2 }, { count: 3 }] } }));
  });

  it('serializes errors without message or stack secrets', () => {
    const error = new Error('failure for jane.patient@example.test with Bearer top-secret-token');
    error.stack = 'Error: failure for jane.patient@example.test\n    at /private/MRN-7F3A9C';
    const result = redact({ error, errors: [error] });

    expectNoSecrets(result);
    expect((result as { error: { name: string } }).error.name).toBe('Error');
    expect(JSON.stringify(result)).not.toContain('error.stack');
  });

  it('scrubs URL query strings, fragments, headers, and cookies', () => {
    const result = redact({
      request: {
        url: 'https://api.example.test/cases?email=jane.patient%40example.test&mrn=MRN-7F3A9C&token=query-secret-value#session=private-cookie',
        headers: {
          authorization: 'Bearer top-secret-token',
          cookie: 'session=private-cookie',
          'x-api-key': 'sk-provider-secret',
          'content-type': 'application/json',
        },
        cookies: { session: 'private-cookie' },
        body: { email: 'jane.patient@example.test' },
      },
    });

    expectNoSecrets(result);
    const serialized = safeStringify(result);
    expect(serialized).not.toContain('query-secret-value');
    expect(serialized).toContain('content-type');
    expect(serialized).toContain('REDACTED');
  });

  it('redacts Sentry contexts, tags, breadcrumbs, request, and user payloads', () => {
    const result = redactSentryEvent({
      event_id: 'evt-123',
      level: 'error',
      message: 'provider failed for Jane Patient',
      contexts: {
        custom: { email: 'jane.patient@example.test', status: 502 },
        response: { data: { name: 'Jane Patient', patient_mrn: 'MRN-7F3A9C' } },
      },
      tags: {
        email: 'jane.patient@example.test',
        patient_dob: '1987-04-12',
        metadata: { email: 'jane.patient@example.test' },
        category: 'provider',
      },
      breadcrumbs: [
        {
          category: 'http',
          message: 'request to Jane Patient',
          data: { authorization: 'Bearer top-secret-token', cookie: 'session=private-cookie' },
        },
      ],
      request: {
        url: 'https://api.example.test?mrn=MRN-7F3A9C&token=query-secret-value',
        headers: { cookie: 'session=private-cookie' },
        data: { email: 'jane.patient@example.test' },
      },
      user: { email: 'jane.patient@example.test', name: 'Jane Patient' },
    });

    expectNoSecrets(result);
    expect(result.event_id).toBe('evt-123');
    expect(result.request).not.toHaveProperty('body');
    expect(result.contexts).toEqual(expect.objectContaining({ custom: expect.objectContaining({ status: 502 }) }));
    expect(result.tags).toEqual(expect.objectContaining({ category: 'provider' }));
  });

  it('redacts AI provider response objects containing PHI', () => {
    const result = redact({
      providerResponse: {
        id: 'response-1',
        model: 'safe-model',
        message: 'Jane',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Contact jane.patient@example.test about MRN-7F3A9C',
            name: 'Jane Patient',
          },
        }],
        metadata: {
          patient_email: 'jane.patient@example.test',
          patient_mrn: 'MRN-7F3A9C',
          patient_dob: '1987-04-12',
          full_name: 'Jane Patient',
        },
        usage: { total_tokens: 10 },
      },
    });

    expectNoSecrets(result);
    expect((result as { providerResponse: { id: string; usage: { total_tokens: number } } }).providerResponse.id).toBe('response-1');
    expect((result as { providerResponse: { usage: { total_tokens: number } } }).providerResponse.usage.total_tokens).toBe(10);
  });

  it('caps depth and serialized size and handles cycles', () => {
    const cyclic: Record<string, unknown> = { safe: 'ok' };
    cyclic.self = cyclic;
    const oversized = { values: Array.from({ length: 100 }, (_, index) => ({ index, name: 'Jane Patient' })) };
    const result = redact({ cyclic, oversized });

    expectNoSecrets(result);
    expect(safeStringify(result).length).toBeLessThan(20_000);
    expect(result).toHaveProperty('cyclic');
  });

  it('creates stable event IDs without embedding event data', () => {
    const first = createEventId('ai.provider.failure', { provider: 'openai', status: 502 });
    const second = createEventId('ai.provider.failure', { provider: 'openai', status: 502 });

    expect(first).toBe(second);
    expect(first).toMatch(/^evt_[a-z0-9]+$/i);
    expect(first).not.toContain('openai');
  });
});
