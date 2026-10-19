import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const source = readFileSync(
  resolve(repoRoot, 'supabase/functions/ai-quality/index.ts'),
  'utf8',
);

describe('AI quality PHI boundary', () => {
  it('derives deidentification from the server record and applies the field validator', () => {
    expect(source).toContain('validateDeidentifiedFieldValues');
    expect(source).toContain('caseEntry.is_deidentified');
    expect(source).not.toContain('body.is_deidentified');
    expect(source).not.toContain('patient_mrn');
    expect(source).not.toContain('patient_dob');
  });

  it('validates provider output before the result is logged or returned', () => {
    expect(source.indexOf('validateStructuredOutput')).toBeLessThan(source.indexOf('insertQualityLog'));
    expect(source.indexOf('const result: QualityResult')).toBeLessThan(source.indexOf('return new Response(JSON.stringify(result)'));
    expect(source).not.toContain('is_deidentified: true');
    expect(source).not.toContain('Template Name: ${template.name');
    expect(source).toContain('validateDeidentifiedFieldValues');
    expect(source).toContain("query: '[HASHED]'");
    expect(source).toContain("response: '[REDACTED]'");
  });
});
