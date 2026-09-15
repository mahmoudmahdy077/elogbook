/**
 * N7.2 — persisted theme override + RTL restart detection (pure helpers).
 *
 * The override ('light' | 'dark' | system) is device-level UI preference
 * stored unencrypted in AsyncStorage (no identity/PHI involved).
 * I18nManager direction flips require a restart to fully relayout: callers
 * use directionChanged() to surface a restart notice instead of a half-RTL UI.
 */

export type ThemeOverride = 'light' | 'dark' | null;

const KEY = 'theme_mode';

export function parseThemeOverride(raw: string | null | undefined): ThemeOverride {
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

export function serializeThemeOverride(mode: ThemeOverride): string {
  return mode ?? 'system';
}

/** True when the required direction differs from the applied one. */
export function directionChanged(applied: 'ltr' | 'rtl', required: 'ltr' | 'rtl'): boolean {
  return applied !== required;
}

export const THEME_STORAGE_KEY = KEY;
