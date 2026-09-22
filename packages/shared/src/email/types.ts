// packages/shared/src/email/types.ts
export type TemplateKey = 'invite.welcome' | 'contact.admin-alert' | 'case.pending-review' | 'case.approved' | 'case.rejected' | 'digest.weekly' | 'newsletter.generic';
export interface TemplateRecord { subject: string; html: string; text: string | null }
export interface OutboundMessage { to: string; toName?: string; templateKey: TemplateKey; subject: string; html: string; text?: string; headers?: Record<string, string> }
