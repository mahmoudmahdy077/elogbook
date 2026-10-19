import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('rejects oversized content on the byte budget without a DLP scan', () => {
    // Over budget by one byte, and carrying identifying content that the
    // in-budget scan below must still catch. The budget verdict must be
    // reached without paying for the scan.
    const oversized = `${'x'.repeat(aiSchemas.AI_MAX_OUTPUT_BYTES)} patient jane@example.test`;
    expect(oversized.length).toBeGreaterThan(aiSchemas.AI_MAX_OUTPUT_BYTES);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: oversized }).success).toBe(false);
  });

  it('still scans in-budget content for identifying values', () => {
    // The same identifying content the guard short-circuits above, now inside
    // the byte budget, so it has to be the DLP scan that rejects it.
    const inBudget = 'A safe summary. Contact jane.doe@example.test for the rota.';
    expect(new TextEncoder().encode(inBudget).byteLength).toBeLessThanOrEqual(aiSchemas.AI_MAX_OUTPUT_BYTES);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: inBudget }).success).toBe(false);
  });

  it.each([
    ['email', 'Contact the team at jane.doe@example.test for the rota.'],
    ['phone', 'The on-call number is +1 555 555 1212 for the night shift.'],
    ['mrn', 'The record MRN-4412093 was filed under this rotation.'],
    ['person name', 'Reviewed by Dr Alice Wonderland before the case list.'],
    ['street address', 'The patient lives at 221B Baker Street this year.'],
    ['date of birth', 'The date of birth on file is 1984-03-17 for them.'],
    ['executable content', 'Prioritise <script>alert(1)</script> in the summary.'],
  ])('rejects in-budget %s in model output content', (_label, content) => {
    expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(aiSchemas.AI_MAX_OUTPUT_BYTES);
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content }).success).toBe(false);
  });

  it('accepts valid bounded output after the budget guard', () => {
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: 'A safe educational summary.' }).success).toBe(true);
    expect(aiSchemas.aiModelOutputSchema.safeParse({
      content: 'Appendectomy under general anaesthesia. No complications recorded. Follow-up in clinic.',
    }).success).toBe(true);
  });

  it('still rejects an oversized tool call name and query log entry', () => {
    // The budget guard is shared by every safeText consumer, not just content.
    expect(aiSchemas.aiModelOutputSchema.safeParse({
      content: 'safe',
      tool_calls: [{ name: 'n'.repeat(65), arguments: {} }],
    }).success).toBe(false);
    expect(aiSchemas.aiQueryLogSchema.safeParse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
      resident_id: null,
      query: 'q'.repeat(aiSchemas.AI_MAX_INPUT_BYTES + 1),
      response: null,
      tokens_used: null,
      model: null,
      provider: null,
      status: 'pending',
      disclaimer_rendered: false,
      safety_flags: [],
      response_format: 'json',
      error_message: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }).success).toBe(false);
  });

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

/**
 * The DLP scan has to stay linear in the size of the value it is handed.
 *
 * `safeText` rejects an over-budget value on length before the scan runs, so the
 * only strings that reach `PHI_CONTENT` are in budget -- 32KB of them are
 * ordinary input, not a mistake. The e-mail alternative used to open with an
 * unbounded `+`, so on a long run of characters that match it and no `@`, the
 * engine retried the run from every offset: quadratic, and most of a second of
 * CPU inside a budget that is meant to be a hard ceiling.
 *
 * The assertion is on the bound itself rather than on a stopwatch. A timing
 * assertion is a flaky assertion; a regression here is a structural property of
 * the pattern, which a source assertion pins without measuring anything.
 */
describe('the PHI scan is bounded work, not a stopwatch', () => {
  const source = readFileSync(resolve(process.cwd(), 'src', 'schemas', 'ai.ts'), 'utf8');

  it('bounds the e-mail local part instead of matching an unbounded run', () => {
    // RFC 5321 caps a local part at 64 octets, so 64 is the honest bound rather
    // than an arbitrary one. A bound only the prose knows about is a bound
    // nobody enforces.
    expect(source).toContain('[A-Z0-9._%+-]{1,64}@');
    // The shape this replaces: an unbounded `+` immediately before the `@` is
    // what makes the alternative quadratic, and it is the only place a `+`
    // local part appears in the scanner.
    const emailAlternative = source.match(/const PHI_CONTENT = [^\n]*/)?.[0] ?? '';
    expect(emailAlternative).toContain('[A-Z0-9._%+-]{1,64}@');
    expect(emailAlternative).not.toContain('[A-Z0-9._%+-]+@');
  });

  it('rejects a 32KB adversarial string that ends in a real address', () => {
    // 32KB is inside every budget, so this is exactly the string the byte guard
    // forwards to the scan: 32k characters that all match the local-part class,
    // then an address that has to be found at the very end of them.
    const adversarial = `${'a'.repeat(32_000)} rotate.jane.doe@example.test`;
    expect(new TextEncoder().encode(adversarial).byteLength).toBeLessThanOrEqual(
      aiSchemas.AI_MAX_OUTPUT_BYTES,
    );
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content: adversarial }).success).toBe(false);
  });

  it('still detects an address whose local part sits at the bound', () => {
    // The bound must not become a blind spot: 64 characters is the longest local
    // part a real address can have, and it still has to be found.
    const content = `Rota contact ${'a'.repeat(64)}@example.test for the night shift.`;
    expect(aiSchemas.aiModelOutputSchema.safeParse({ content }).success).toBe(false);
  });
});
