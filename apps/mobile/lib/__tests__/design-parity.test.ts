import { describe, it, expect } from 'vitest';
import { clinicalTokens } from '@elogbook/shared';
import { nativeTokens, statusBarStyleFor, directionForLocale, formatCount } from '../design-tokens';

describe('design parity M6 (single source)', () => {
  it('derives spacing/radius/colors from shared tokens (no drift)', () => {
    expect(nativeTokens.spacing).toEqual(clinicalTokens.spacing);
    expect(nativeTokens.radius).toEqual(clinicalTokens.radius);
    expect(nativeTokens.colors.primary.DEFAULT).toBe(clinicalTokens.colors.primary.DEFAULT);
    expect(nativeTokens.colors.text.primary).toBe(clinicalTokens.colors.text.primary);
  });

  it('maps status-bar contrast per theme', () => {
    expect(statusBarStyleFor('light')).toBe('dark');
    expect(statusBarStyleFor('dark')).toBe('light');
  });

  it('resolves RTL direction from locale', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('ar-EG')).toBe('rtl');
    expect(directionForLocale('en')).toBe('ltr');
  });

  it('formats counts with locale-aware numbers', () => {
    expect(formatCount(1234, 'en')).toContain('1');
    expect(typeof formatCount(1234, 'ar')).toBe('string');
  });
});
