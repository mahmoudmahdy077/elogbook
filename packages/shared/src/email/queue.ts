// packages/shared/src/email/queue.ts
import type { TemplateKey } from './types';
export interface EnqueueInput { templateKey: TemplateKey; to: string; toName?: string; tenantId?: string; payload: Record<string, string>; priority?: number }
export function buildQueueRow(input: EnqueueInput) {
  return { template_key: input.templateKey, to_email: input.to.trim().toLowerCase(), to_name: input.toName ?? null, tenant_id: input.tenantId ?? null, payload: input.payload, priority: input.priority ?? 0, status: 'pending' };
}
