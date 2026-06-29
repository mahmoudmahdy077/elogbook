import { z } from 'zod';

/**
 * Zod schemas for the `payments` table.
 */
export const paymentStatusSchema = z.enum(['pending', 'completed', 'failed', 'refunded']);

export const paymentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  subscription_id: z.string().uuid().nullable(),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
  status: paymentStatusSchema,
  stripe_event_id: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
});

export const oneTimePurchaseSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  resident_id: z.string().uuid().nullable(),
  purchase_type: z.string().min(1).max(50),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
  stripe_payment_intent_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
});

/** Input schema for initiating a one-time purchase (e.g. premium upgrade for individual residents). */
export const initiateOneTimePurchaseSchema = z.object({
  purchase_type: z.string().min(1).max(50),
  amount_cents: z.number().int().min(99).max(1_000_000),
  currency: z.string().length(3).default('USD'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
