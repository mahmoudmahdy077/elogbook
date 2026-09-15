/**
 * M6 — single-source native design tokens.
 *
 * Colors, spacing, and radius derive from `@elogbook/shared` clinicalTokens
 * (the web contract). Font stacks map to the families loaded in
 * app/_layout.tsx (Outfit/Inter/GeistMono). Shadows stay 'none' per the
 * clinical identity. The dead duplicate scale (lib/design-system) is
 * removed — this module is the only native token source.
 */

import { clinicalTokens } from '@elogbook/shared';

export type ThemeMode = 'light' | 'dark';
export type Direction = 'ltr' | 'rtl';

export const nativeTokens = {
  colors: clinicalTokens.colors,
  spacing: clinicalTokens.spacing,
  radius: clinicalTokens.radius,
  fonts: {
    heading: 'Outfit-Bold',
    body: 'Inter',
    bodyMedium: 'Inter-Medium',
    bodySemiBold: 'Inter-SemiBold',
    mono: 'GeistMono',
  },
  touchTarget: 44,
} as const;

/** Status-bar contrast per theme (light theme → dark bar content). */
export function statusBarStyleFor(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'light' ? 'dark' : 'light';
}

/** RTL for Arabic locales, LTR otherwise (shared requirement, not mobile-only). */
export function directionForLocale(locale: string): Direction {
  return locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
}

/** Locale-aware count formatting (falls back to plain digits). */
export function formatCount(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

/** Locale-aware date formatting (ISO fallback). */
export function formatDateLocal(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${iso}T00:00:00`));
  } catch {
    return iso;
  }
}
