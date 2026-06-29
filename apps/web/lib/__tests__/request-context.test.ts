import { describe, it, expect } from 'vitest';
import { requestContext, newRequestId } from '../request-context';

describe('requestContext', () => {
  it('returns undefined outside of a run() scope', () => {
    expect(requestContext.get()).toBeUndefined();
    expect(requestContext.getRequestId()).toBeUndefined();
  });

  it('exposes context inside a run() scope', () => {
    requestContext.run({ requestId: 'abc-123', route: '/x' }, () => {
      expect(requestContext.getRequestId()).toBe('abc-123');
      expect(requestContext.get()?.route).toBe('/x');
    });
    expect(requestContext.get()).toBeUndefined();
  });

  it('isolates concurrent contexts (AsyncLocalStorage semantics)', async () => {
    const results: string[] = [];
    await Promise.all([
      requestContext.run({ requestId: 'req-A' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(requestContext.getRequestId() ?? 'none');
      }),
      requestContext.run({ requestId: 'req-B' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(requestContext.getRequestId() ?? 'none');
      }),
    ]);
    expect(results).toContain('req-A');
    expect(results).toContain('req-B');
  });

  it('newRequestId returns unique strings', () => {
    const ids = new Set([newRequestId(), newRequestId(), newRequestId(), newRequestId()]);
    expect(ids.size).toBe(4);
  });
});
