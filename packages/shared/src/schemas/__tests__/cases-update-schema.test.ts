import { describe, expect, it } from 'vitest';
import { caseTemplateUpdateSchema } from '../cases';

describe('caseTemplateSchema updates', () => {
  it('accepts a partial template update without losing field invariants', () => {
    expect(caseTemplateUpdateSchema.safeParse({ name: 'Updated' }).success).toBe(true);
    expect(caseTemplateUpdateSchema.safeParse({ fields: [] }).success).toBe(false);
  });
});
