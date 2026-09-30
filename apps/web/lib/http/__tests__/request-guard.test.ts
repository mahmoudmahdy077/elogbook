import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { guardRequest, withRequestGuard } from '../request-guard';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().optional(),
}).strict();

const origin = 'https://app.elogbook.dev';

function makeRequest(
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
): Request {
  return new Request(`${origin}/api/example`, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('request guard', () => {
  it('rejects a missing or disallowed origin', async () => {
    const missing = await guardRequest(makeRequest('{}', { origin: '' }, 'POST'), schema, {
      trustedOrigins: [origin],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(403);

    const disallowed = await guardRequest(
      makeRequest('{}', { origin: 'https://evil.example' }),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(disallowed.ok).toBe(false);
    if (!disallowed.ok) expect(disallowed.response.status).toBe(403);
  });

  it('accepts an allowed origin and validates the body', async () => {
    const result = await guardRequest(
      makeRequest(JSON.stringify({ name: 'Audit', enabled: true })),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ name: 'Audit', enabled: true });
  });

  it('rejects missing or non-JSON content types', async () => {
    const missing = await guardRequest(
      makeRequest('{}', { 'content-type': '' }),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(415);

    const text = await guardRequest(
      makeRequest('{}', { 'content-type': 'text/plain' }),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.response.status).toBe(415);
  });

  it('rejects declared and streamed bodies over the limit', async () => {
    const declared = await guardRequest(
      makeRequest(JSON.stringify({ name: 'Audit' }), { 'content-length': '1000000' }),
      schema,
      { trustedOrigins: [origin], maxBodyBytes: 64 },
    );
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.response.status).toBe(413);

    const streamed = await guardRequest(
      makeRequest(JSON.stringify({ name: 'A'.repeat(100) })),
      schema,
      { trustedOrigins: [origin], maxBodyBytes: 32 },
    );
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.response.status).toBe(413);
  });

  it('rejects malformed JSON and unknown keys', async () => {
    const malformed = await guardRequest(
      makeRequest('{"name":'),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.response.status).toBe(400);

    const unknown = await guardRequest(
      makeRequest('{"name":"Audit","unexpected":true}'),
      schema,
      { trustedOrigins: [origin] },
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.response.status).toBe(400);
      expect(await unknown.response.text()).not.toContain('unexpected');
    }
  });

  it('returns generic errors from a guarded route handler', async () => {
    const handler = vi.fn(async (_request: Request, _data: unknown) => {
      throw new Error('private database detail');
    });
    const guarded = withRequestGuard(handler, {
      schema,
      trustedOrigins: [origin],
    });

    const response = await guarded(makeRequest('{"name":"Audit"}'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private database detail');
  });
});
