import { z } from 'zod';

export const subscriptionPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  price_monthly: z.number().min(0),
  features: z.record(z.unknown()),
  tenant_type: z.enum(['individual', 'institution']),
  max_residents: z.number().int().nullable().optional(),
});

export const paymentGatewayConfigSchema = z.object({
  provider: z.enum(['stripe', 'paddle', 'lemonsqueezy', 'custom']),
  publishable_key: z.string().min(1),
  encrypted_secret_key: z.string().min(1),
  encrypted_webhook_secret: z.string().min(1),
  endpoint_url: z.string().url().nullable().optional(),
  is_active: z.boolean(),
});
