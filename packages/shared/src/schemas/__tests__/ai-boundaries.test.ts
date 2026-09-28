import { describe, expect, it } from 'vitest';
import * as aiSchemas from '../ai';

const tenantId = '123e4567-e89b-12d3-a456-426614174000';
const actorId = '123e4567-e89b-12d3-a456-426614174001';

describe('AI boundary schemas', () => {
  it('accepts a bounded request and rejects unbounded input or fan-out', () => {
    const request = {
      tenant_id: tenantId,
      actor_id: actorId,
        action: 'ai:insights',
       input: 'auto-analysis',
       field_values: { age_group: 'adult' },
       input_tokens: 100,

      max_output_tokens: 256,
      max_cost_cents: 2,
      fan_out: 2,
    };

    expect(aiSchemas.aiRequestSchema.safeParse(request).success).toBe(true);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, input: 'arbitrary clinical narrative' }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, field_values: undefined, is_deidentified: true }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, stream: true }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, fan_out: 9 }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, input_tokens: 10_000 }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({ ...request, max_output_tokens: 10_000 }).success).toBe(false);
  });

  it('rejects structurally invalid or executable model output', () => {
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: 'A safe educational summary.' }).success).toBe(true);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: '<script>alert(1)</script>' }).success).toBe(false);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: 'javascript:alert(1)' }).success).toBe(false);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: 'safe', tool_calls: [{ name: 'shell' }] }).success).toBe(false);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: 'safe', tool_calls: [{ name: 'read_case' }] }).success).toBe(false);
  });

  it('rejects output that exceeds token, byte, or cost budgets', () => {
    expect(aiSchemas.aiModelOutputSchema.safeParse({
      content: 'safe',
      usage: { input_tokens: 1, output_tokens: 10_001, total_tokens: 10_002, cost_cents: 1 },
    }).success).toBe(false);
    expect(aiSchemas.aiModelOutputSchema.safeParse({
      content: 'x'.repeat(aiSchemas.AI_MAX_OUTPUT_BYTES + 1),
    }).success).toBe(false);
    expect(aiSchemas.aiModelOutputSchema.safeParse({
      content: 'safe',
      usage: { input_tokens: 1, output_tokens: 10, total_tokens: 11, cost_cents: 101 },
    }).success).toBe(false);
  }, 20_000);

  it('rejects unknown and identifying fields before an AI boundary is reached', () => {
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ procedure: 'Appendectomy' }).success).toBe(true);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ patient_name: 'Jane Doe' }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ notes: { email: 'jane@example.test' } }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ notes: { phone: '+1 555 555 1212' } }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ procedure_code: 123456 }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ notes: '123 Main Street' }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ notes: '2024-01-01' }).success).toBe(false);
  });

  it('accepts only bounded structured clinical values', () => {
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({
      procedure_name: 'Appendectomy',
      anesthesia_type: 'General',
      supervision_level: 'Observed',
      modality: 'CT',
      body_part: 'Abdomen',
      age_group: 'adult',
      contrast_used: 'None',
    }).success).toBe(true);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ notes: 'The patient had a complicated postoperative course.' }).success).toBe(false);
    expect(aiSchemas.aiDeidentifiedFieldValuesSchema.safeParse({ findings: 'No acute finding' }).success).toBe(false);
  });

  it('rejects identifying structured output text', () => {
    expect(aiSchemas.aiQualityOutputSchema.safeParse({
      scores: { completeness: 80, specificity: 80, classification: 80, overall: 80 },
      suggestions: ['Email jane@example.test', 'Review with Jane Doe'],
    }).success).toBe(false);
  });

  it('requires a deterministic tenant and actor identity on every request', () => {
    expect(aiSchemas.aiRequestSchema.safeParse({
      tenant_id: tenantId,
      actor_id: actorId,
       action: 'ai:insights',
       input: 'auto-analysis',
       field_values: { age_group: 'adult' },

    }).success).toBe(true);
    expect(aiSchemas.aiRequestSchema.safeParse({
      tenant_id: 'not-a-tenant',
      actor_id: actorId,
       action: 'ai:insights',
       input: 'auto-analysis',
       field_values: { age_group: 'adult' },

    }).success).toBe(false);
    expect(aiSchemas.aiRequestSchema.safeParse({
      tenant_id: tenantId,
       action: 'ai:insights',
       input: 'auto-analysis',
       field_values: { age_group: 'adult' },

    }).success).toBe(false);
  });
});
