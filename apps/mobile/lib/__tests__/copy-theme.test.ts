import { describe, it, expect } from 'vitest';
import { t, missingKeys, type CopyKey } from '../copy';
import { parseThemeOverride, serializeThemeOverride, directionChanged } from '../theme-store';

describe('copy keys (N7.4 inventory)', () => {
  it('resolves English source and Arabic translations with English fallback', () => {
    const key: CopyKey = 'offline.savedOnDevice';
    expect(t(key, 'en')).toContain('device');
    expect(t(key, 'ar')).not.toBe(t(key, 'en'));
    expect(t('offline.savedOnDevice' as CopyKey, 'fr')).toBe(t(key, 'en'));
  });

  it('reports missing translations per locale (no silent gaps)', () => {
    expect(missingKeys('en')).toEqual([]);
    expect(Array.isArray(missingKeys('ar'))).toBe(true);
  });
});

describe('theme store (N7.2 persistence + RTL restart)', () => {
  it('round-trips light/dark/system overrides', () => {
    expect(parseThemeOverride('dark')).toBe('dark');
    expect(parseThemeOverride('light')).toBe('light');
    expect(parseThemeOverride('banana')).toBeNull();
    expect(parseThemeOverride(null)).toBeNull();
    expect(serializeThemeOverride('dark')).toBe('dark');
    expect(serializeThemeOverride(null)).toBe('system');
  });

  it('detects RTL changes that need a restart to fully apply', () => {
    expect(directionChanged('ltr', 'rtl')).toBe(true);
    expect(directionChanged('rtl', 'rtl')).toBe(false);
  });
});
