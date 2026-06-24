import { describe, it, expect } from 'vitest';
import { subscriptionPlanSchema, paymentGatewayConfigSchema } from '../subscriptions';

describe('subscriptionPlanSchema', () => {
  const validPlan = {
    name: 'Premium Monthly',
    slug: 'premium-monthly',
    price_monthly: 29.99,
    features: { max_residents: 50, ai_insights: true },
    tenant_type: 'institution',
  };

  it('should accept a valid subscription plan', () => {
    const result = subscriptionPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it('should accept plan with stripe_price_id', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      stripe_price_id: 'price_1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('should accept plan with nullable stripe_price_id', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      stripe_price_id: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept individual tenant type', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      tenant_type: 'individual',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid slug format (uppercase)', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      slug: 'Premium-Monthly',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative price', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      price_monthly: -10,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid tenant_type', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      tenant_type: 'government',
    });
    expect(result.success).toBe(false);
  });

  it('should accept plan with max_residents', () => {
    const result = subscriptionPlanSchema.safeParse({
      ...validPlan,
      max_residents: 100,
    });
    expect(result.success).toBe(true);
  });
});

describe('paymentGatewayConfigSchema', () => {
  const validConfig = {
    provider: 'stripe',
    publishable_key: 'pk_test_1234567890',
    is_active: true,
  };

  it('should accept a valid stripe config', () => {
    const result = paymentGatewayConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should accept config with endpoint_url', () => {
    const result = paymentGatewayConfigSchema.safeParse({
      ...validConfig,
      endpoint_url: 'https://api.stripe.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('should accept paddle provider', () => {
    const result = paymentGatewayConfigSchema.safeParse({
      ...validConfig,
      provider: 'paddle',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid provider', () => {
    const result = paymentGatewayConfigSchema.safeParse({
      ...validConfig,
      provider: 'square',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty publishable_key', () => {
    const result = paymentGatewayConfigSchema.safeParse({
      ...validConfig,
      publishable_key: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid URL for endpoint_url', () => {
    const result = paymentGatewayConfigSchema.safeParse({
      ...validConfig,
      endpoint_url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});
