import { describe, it, expect } from 'vitest';
import { requestContext, newRequestId, createLogContext } from '../request-context';

describe('requestContext', () => {
  it('returns undefined outside of a run() scope', () => {
    expect(requestContext.get()).toBeUndefined();
    expect(requestContext.getRequestId()).toBeUndefined();
    expect(requestContext.getTenantId()).toBeUndefined();
    expect(requestContext.getUserId()).toBeUndefined();
  });

  it('exposes context inside a run() scope', () => {
    requestContext.run({ requestId: 'abc-123', route: '/x', userId: 'u-1', tenantId: 't-1' }, () => {
      expect(requestContext.getRequestId()).toBe('abc-123');
      expect(requestContext.getTenantId()).toBe('t-1');
      expect(requestContext.getUserId()).toBe('u-1');
      expect(requestContext.get()?.route).toBe('/x');
      expect(requestContext.get()?.method).toBeUndefined();
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

describe('createLogContext', () => {
  it('returns unknown requestId outside of a run scope', () => {
    const ctx = createLogContext();
    expect(ctx.requestId).toBe('unknown');
    expect(ctx.timestamp).toBeDefined();
  });

  it('includes context fields inside a run scope', () => {
    requestContext.run({ requestId: 'req-1', tenantId: 't-1', userId: 'u-1', route: '/cases', method: 'GET' }, () => {
      const ctx = createLogContext();
      expect(ctx.requestId).toBe('req-1');
      expect(ctx.tenantId).toBe('t-1');
      expect(ctx.userId).toBe('u-1');
      expect(ctx.route).toBe('/cases');
      expect(ctx.method).toBe('GET');
    });
  });

  it('merges extra fields into the context', () => {
    requestContext.run({ requestId: 'req-2' }, () => {
      const ctx = createLogContext({ source: 'webhook', priority: 'high' });
      expect(ctx.requestId).toBe('req-2');
      expect(ctx.source).toBe('webhook');
      expect(ctx.priority).toBe('high');
    });
  });
});
