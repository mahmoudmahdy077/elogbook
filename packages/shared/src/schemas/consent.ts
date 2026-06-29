import { z } from 'zod';

export const consentTypeSchema = z.enum(['research', 'analytics', 'data_sharing', 'training']);

export const consentRecordSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  user_id: z.string().uuid(),
  consent_type: consentTypeSchema,
  granted: z.boolean(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Input for granting or revoking consent. */
export const recordConsentSchema = z.object({
  consent_type: consentTypeSchema,
  granted: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
