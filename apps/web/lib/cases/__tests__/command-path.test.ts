import { describe, expect, it } from 'vitest';
import { caseSubmitPath } from '../submit-flow';

describe('caseSubmitPath', () => {
  it('resolves the API route, not a tenant-prefixed page path', () => {
    expect(caseSubmitPath('acme', 'case-123')).toBe('/api/acme/cases/case-123/submit');
  });
});
