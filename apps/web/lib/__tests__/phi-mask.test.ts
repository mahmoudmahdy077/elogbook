import { describe, it, expect } from 'vitest';
import { maskMrn, maskDob } from '../phi-mask';

describe('phi-mask', () => {
  it('keeps only the last 4 characters of a normal MRN', () => {
    expect(maskMrn('MRN-998877')).toBe('***-**-8877');
    expect(maskMrn('123456')).toBe('***-**-3456');
  });

  it('masks short MRNs completely instead of showing them', () => {
    expect(maskMrn('1234')).toBe('****');
    expect(maskMrn('123')).toBe('***');
    expect(maskMrn('1234')).not.toContain('1234');
  });

  it('keeps only the last 2 characters of a normal date of birth', () => {
    expect(maskDob('1990-01-02')).toBe('****-**-02');
  });

  it('masks short dates of birth completely', () => {
    expect(maskDob('1990')).toBe('****');
    expect(maskDob('1990')).not.toContain('1990');
  });

  it('renders an em dash when the value is absent', () => {
    expect(maskMrn(null)).toBe('—');
    expect(maskMrn('')).toBe('—');
    expect(maskDob(undefined)).toBe('—');
  });
});
