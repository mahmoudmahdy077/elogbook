import { describe, it, expect } from 'vitest';
import { contrastRatio, validateThemePublish, PLATFORM_THEME_CEILINGS } from '../theme-policy';

// T22: disallowed/low-contrast themes cannot publish; platform ceilings
// bound tenant overrides; revert restores a prior revision (route-level).
describe('contrastRatio (T22)', () => {
  it('scores black-on-white at 21 and identical colors at 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#007AFF', '#007AFF')).toBeCloseTo(1, 2);
  });

  it('scores the platform default in the large-text/action band', () => {
    const r = contrastRatio('#007AFF', '#FFFFFF');
    expect(r).toBeGreaterThan(3.0);
    expect(r).toBeLessThan(4.5);
  });
});

describe('validateThemePublish (T22)', () => {
  it('accepts a valid theme with warnings (never silent)', () => {
    const res = validateThemePublish(
      { primary_color: '#007AFF', logo_url: 'https://cdn.example.com/l.png' },
      PLATFORM_THEME_CEILINGS,
    );
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('blocks contrast below 3.0', () => {
    const res = validateThemePublish({ primary_color: '#EEEEEE' }, PLATFORM_THEME_CEILINGS);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/contrast/i);
  });

  it('blocks disallowed keys and invalid values with reasons', () => {
    const res = validateThemePublish(
      { primary_color: '#007AFF', custom_css: 'body{display:none}', logo_url: 'http://x/y.png' },
      PLATFORM_THEME_CEILINGS,
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/custom_css/);
    expect(res.errors.join(' ')).toMatch(/logo/i);
  });

  it('platform ceilings can narrow the palette or forbid logos', () => {
    const tight = { ...PLATFORM_THEME_CEILINGS, allowLogos: false, allowedPrimaries: ['#007AFF'] as string[] };
    expect(validateThemePublish({ primary_color: '#0A84FF' }, tight).ok).toBe(false);
    expect(
      validateThemePublish({ primary_color: '#007AFF', logo_url: 'https://cdn.example.com/l.png' }, tight).ok,
    ).toBe(false);
    expect(validateThemePublish({ primary_color: '#007AFF' }, tight).ok).toBe(true);
  });
});
