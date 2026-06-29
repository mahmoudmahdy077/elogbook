import { z } from 'zod';

export const aiQueryLogStatusSchema = z.enum(['pending', 'completed', 'failed', 'rate_limited', 'quota_exceeded']);

export const aiQueryLogSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  resident_id: z.string().uuid().nullable(),
  query: z.string().min(1),
  response: z.string().nullable(),
  tokens_used: z.number().int().nullable(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  status: aiQueryLogStatusSchema.default('pending'),
  disclaimer_rendered: z.boolean().default(false),
  safety_flags: z.array(z.string()).default([]),
  response_format: z.enum(['json', 'stream']).default('json'),
  /** Free-form error message if status='failed'. */
  error_message: z.string().nullable(),
  created_at: z.string(),
});

export const aiResponseCacheSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  resident_id: z.string().uuid().nullable(),
  query_hash: z.string().length(64), // sha256 hex
  query_text: z.string(),
  response_text: z.string(),
  model: z.string(),
  provider: z.string(),
  tokens_used: z.number().int(),
  expires_at: z.string(),
  created_at: z.string(),
});
