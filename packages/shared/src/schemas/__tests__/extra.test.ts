import { describe, it, expect } from 'vitest';
import { paymentSchema, initiateOneTimePurchaseSchema } from '../payments';
import { consentRecordSchema, recordConsentSchema } from '../consent';
import { aiQueryLogSchema, aiResponseCacheSchema } from '../ai';

describe('paymentSchema', () => {
  const valid = {
    id: '0d4d2c5e-7f0a-4b1c-8e9d-2a3b4c5d6e7f',
    tenant_id: '0d4d2c5e-7f0a-4b1c-8e9d-2a3b4c5d6e7f',
    subscription_id: null,
    amount: 1999,
    currency: 'USD',
    status: 'completed' as const,
    stripe_event_id: 'evt_1',
    stripe_payment_intent_id: 'pi_1',
    description: 'Test',
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid payment', () => {
    const r = paymentSchema.safeParse(valid);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('rejects negative amount', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it('rejects invalid currency code', () => {
    expect(paymentSchema.safeParse({ ...valid, currency: 'DOLLARS' }).success).toBe(false);
  });
});

describe('initiateOneTimePurchaseSchema', () => {
  it('accepts a valid input', () => {
    expect(initiateOneTimePurchaseSchema.safeParse({
      purchase_type: 'premium_year',
      amount_cents: 9999,
    }).success).toBe(true);
  });

  it('rejects amount < 99 cents', () => {
    expect(initiateOneTimePurchaseSchema.safeParse({
      purchase_type: 'x',
      amount_cents: 50,
    }).success).toBe(false);
  });
});

describe('recordConsentSchema', () => {
  it('accepts a valid consent record', () => {
    expect(recordConsentSchema.safeParse({
      consent_type: 'analytics',
      granted: true,
    }).success).toBe(true);
  });

  it('rejects unknown consent type', () => {
    expect(recordConsentSchema.safeParse({
      consent_type: 'marketing',
      granted: true,
    }).success).toBe(false);
  });
});

describe('aiQueryLogSchema', () => {
  const valid = {
    id: '0d4d2c5e-7f0a-4b1c-8e9d-2a3b4c5d6e7f',
    tenant_id: '0d4d2c5e-7f0a-4b1c-8e9d-2a3b4c5d6e7f',
    resident_id: '0d4d2c5e-7f0a-4b1c-8e9d-2a3b4c5d6e7f',
    query: 'Summarize case 1',
    response: 'Summary text',
    tokens_used: 100,
    model: 'gpt-4o',
    provider: 'openai',
    status: 'completed' as const,
    disclaimer_rendered: true,
    safety_flags: [],
    response_format: 'json' as const,
    error_message: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid log entry', () => {
    const r = aiQueryLogSchema.safeParse(valid);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });

  it('rejects empty query', () => {
    expect(aiQueryLogSchema.safeParse({ ...valid, query: '' }).success).toBe(false);
  });
});

describe('aiResponseCacheSchema', () => {
  it('rejects a non-64-char query_hash', () => {
    expect(aiResponseCacheSchema.safeParse({
      id: '11111111-2222-3333-4444-555555555555',
      tenant_id: null,
      resident_id: null,
      query_hash: 'short',
      query_text: 'q',
      response_text: 'r',
      model: 'm',
      provider: 'p',
      tokens_used: 1,
      expires_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    }).success).toBe(false);
  });
});
