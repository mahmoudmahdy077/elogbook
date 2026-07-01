import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  route?: string;
  method?: string;
  userId?: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
  getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },
  getUserId(): string | undefined {
    return storage.getStore()?.userId;
  },
};

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates a structured log object with request context for correlation.
 * Use with the logger for audit trails and debugging.
 */
export function createLogContext(extra?: Record<string, unknown>): Record<string, unknown> {
  const ctx = storage.getStore();
  return {
    requestId: ctx?.requestId ?? 'unknown',
    tenantId: ctx?.tenantId,
    userId: ctx?.userId,
    route: ctx?.route,
    method: ctx?.method,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}
