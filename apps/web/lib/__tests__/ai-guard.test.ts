import { describe, expect, it } from 'vitest';
import {
  enforceAiBudget,
  validateAiModelOutput,
  validateAiRequest,
  validateDeidentifiedFieldValues,
  validateStructuredOutput,
  validateAndSanitizeModelOutput,
  transformDeidentifiedFieldValues,
} from '../../../../supabase/functions/_shared/ai-guard';

const principal = {
  actorId: 'actor-1',
  tenantId: 'tenant-1',
  role: 'supervisor',
  status: 'active',
  aal: 'aal2' as const,
};

describe('AI execution guard', () => {
  it('binds a request to the authenticated tenant and actor', () => {
    const request = {
      tenant_id: 'tenant-1',
      actor_id: 'actor-1',
      action: 'ai:insights',
       input: 'auto-analysis',
       field_values: { age_group: 'adult' },
       is_deidentified: true,

    };
    expect(validateAiRequest(request, principal, { requireDeidentified: true }).ok).toBe(true);
    expect(validateAiRequest({ ...request, tenant_id: 'tenant-2' }, principal).ok).toBe(false);
    expect(validateAiRequest({ ...request, actor_id: 'actor-2' }, principal).ok).toBe(false);
  });

  it('requires server AAL2 for privileged actions', () => {
    const request = {
      tenant_id: 'tenant-1',
      actor_id: 'actor-1',
      action: 'ai:quality',
       input: 'quality-assessment',
       field_values: { age_group: 'adult' },
       is_deidentified: true,

    };
    expect(validateAiRequest(request, { ...principal, aal: 'aal1' }).ok).toBe(false);
  });

  it('rejects unsafe or over-budget model output before it can be used', () => {
    expect(validateAiModelOutput('<script>alert(1)</script>').ok).toBe(false);
    expect(validateAiModelOutput({ content: 'safe', usage: { outputTokens: 2, totalTokens: 2, costCents: 1 } }).ok).toBe(true);
    expect(validateAiModelOutput('safe', { maxOutputBytes: 3 }).ok).toBe(false);
    expect(enforceAiBudget({ outputTokens: 10_000 }).ok).toBe(false);
  });

  it('rejects malformed structured quality output', () => {
    expect(validateStructuredOutput({ scores: { completeness: 101 } }, 'quality').ok).toBe(false);
    expect(validateStructuredOutput('{"scores":{},"suggestions":[]}', 'quality').ok).toBe(false);
  });

  it('accepts built-in clinical template fields while rejecting identifying values', () => {
    expect(validateDeidentifiedFieldValues({
      procedure_name: 'Appendectomy',
      anesthesia_type: 'General',
      supervision_level: 'Observed',
      modality: 'CT',
      body_part: 'Abdomen',
       contrast_used: 'None',
       age_group: 'adult',

    }).ok).toBe(true);
  });

  it('rejects unknown fields and nested identifying values in deidentified case data', () => {
    expect(validateDeidentifiedFieldValues({ procedure: 'Laparoscopic appendectomy' }).ok).toBe(true);
    expect(validateDeidentifiedFieldValues({ patient_name: 'Jane Doe' }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ notes: { contact: { email: 'jane@example.test' } } }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ history: { phone: '+1 (555) 555-1212' } }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ identifiers: { mrn: 'MRN: 123-45-6789' } }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ identifiers: { ssn: '123-45-6789' } }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ procedure_code: 123456 }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ notes: '123 Main Street' }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ notes: '2024-01-01' }).ok).toBe(false);
  });

  it('rejects identifying model output before it can be rendered or logged', () => {
    expect(validateAiModelOutput('Contact jane.doe@example.test about the case.').ok).toBe(false);
    expect(validateAiModelOutput('Jane Doe').ok).toBe(false);
    expect(validateStructuredOutput({
      scores: { completeness: 80, specificity: 80, classification: 80, overall: 80 },
      suggestions: ['Call Jane Doe at +1 555 555 1212'],
    }, 'quality').ok).toBe(false);
  });

  it('rejects free-text clinical values even when the caller marks them deidentified', () => {
    expect(validateDeidentifiedFieldValues({ age_group: 'adult' }).ok).toBe(true);
    expect(validateDeidentifiedFieldValues({ notes: 'The patient had a complicated postoperative course.' }).ok).toBe(false);
    expect(validateDeidentifiedFieldValues({ findings: 'No acute finding' }).ok).toBe(false);
    const transformed = transformDeidentifiedFieldValues({ findings: 'No acute finding' });
    expect(transformed.ok).toBe(true);
    if (transformed.ok) expect(transformed.value.findings).toBe(true);
    expect(transformDeidentifiedFieldValues({ findings: 'Contact jane@example.test' }).ok).toBe(false);
    const requestWithoutFields = {
      tenant_id: 'tenant-1',
      actor_id: 'actor-1',
      action: 'ai:insights',
      input: 'auto-analysis',
      is_deidentified: true,
    };
    expect(validateAiRequest(requestWithoutFields, principal, { requireDeidentified: true }).ok).toBe(false);
  });

  it('detects conservative identifiers without flagging the age_group key', () => {
    for (const value of [
      'Dr. Ada Lovelace',
      'dr. ada lovelace',
      'jane.doe@example.test',
      '+1 (555) 555-1212',
      '123 Main Street',
      'MRN-AB-1234',
      '123-45-6789',
    ]) {
      expect(validateAiModelOutput(value).ok).toBe(false);
    }
    expect(validateAiModelOutput('age_group: adult').ok).toBe(true);
  });

  it('rejects streaming requests until the response can be fully validated', () => {
    expect(validateAiRequest({
      tenant_id: 'tenant-1',
      actor_id: 'actor-1',
      action: 'ai:insights',
      input: 'auto-analysis',
      stream: true,
      is_deidentified: true,
    }, principal).ok).toBe(false);
  });

  it('rejects model output before a cache or log consumer can persist it', () => {
    expect(validateAndSanitizeModelOutput('MRN-AB-1234').ok).toBe(false);
    expect(validateAndSanitizeModelOutput('A safe educational summary.').ok).toBe(true);
  });
});
