import { describe, it, expect } from 'vitest';
import { maskDob, maskMrn } from '../phi-mask';

describe('maskMrn', () => {
  it('keeps only the last four characters of a long MRN', () => {
    expect(maskMrn('MRN-123456')).toBe('***-**-3456');
  });

  it('masks a short identifier completely', () => {
    expect(maskMrn('1234')).toBe('****');
    expect(maskMrn('12')).toBe('**');
  });

  it('renders an em dash for an absent value', () => {
    expect(maskMrn(null)).toBe('—');
    expect(maskMrn(undefined)).toBe('—');
    expect(maskMrn('')).toBe('—');
  });
});

describe('maskDob', () => {
  it('keeps only the last two characters of a date', () => {
    expect(maskDob('1990-04-12')).toBe('****-**-12');
  });

  it('masks a short value completely', () => {
    expect(maskDob('1990')).toBe('****');
  });

  it('renders an em dash for an absent value', () => {
    expect(maskDob(null)).toBe('—');
  });
});
