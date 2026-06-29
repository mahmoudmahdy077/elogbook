import { describe, it, expect } from 'vitest';

// Pure helpers for accessibility — kept in a separate test so the UI
// component (which renders React Native's <Text>) doesn't need a renderer.
function buildAccessibilityLabel(value: unknown, fallback: string): string | undefined {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function isAccessibleTextProps(p: { allowFontScaling?: boolean; maxFontSizeMultiplier?: number }): boolean {
  return p.allowFontScaling === true && (p.maxFontSizeMultiplier ?? 1) >= 1;
}

describe('a11y helpers', () => {
  it('builds an accessibility label from a value, falling back when empty', () => {
    expect(buildAccessibilityLabel('3 drafts', '')).toBe('3 drafts');
    expect(buildAccessibilityLabel('', 'fallback')).toBe('fallback');
    expect(buildAccessibilityLabel(undefined, 'fallback')).toBe('fallback');
  });

  it('flags AccessibleText-shaped props as honoring Dynamic Type', () => {
    expect(isAccessibleTextProps({ allowFontScaling: true, maxFontSizeMultiplier: 1.6 })).toBe(true);
    expect(isAccessibleTextProps({ allowFontScaling: false, maxFontSizeMultiplier: 1.6 })).toBe(false);
    expect(isAccessibleTextProps({ allowFontScaling: true, maxFontSizeMultiplier: 0.5 })).toBe(false);
  });
});
