// packages/shared/src/email/types.ts
export type TemplateKey = 'invite.welcome' | 'contact.admin-alert' | 'case.pending-review' | 'case.approved' | 'case.rejected' | 'digest.weekly' | 'newsletter.generic' | 'auth.invite-fallback-note';
export interface TemplateRecord { subject: string; html: string; text: string | null }
/**
 * `idempotencyKey` is the queue row's own identity. It is sent to the provider
 * as a dedup key so a retry of the same logical message resolves to the same
 * provider-side message instead of a second one. It is not a secret and is not
 * a tenant identifier in any form the recipient sees.
 */
export interface OutboundMessage { to: string; toName?: string; templateKey: TemplateKey; subject: string; html: string; text?: string; headers?: Record<string, string>; idempotencyKey?: string }
