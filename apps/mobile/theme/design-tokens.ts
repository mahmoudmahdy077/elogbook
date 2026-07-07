/**
 * E-Logbook Mobile Design Tokens
 *
 * Apple Health–inspired design system for the mobile app.
 * Mirrors the web `clinicalTokens` from `@elogbook/shared` but provides
 * React Native–friendly values (platform-aware fonts, numeric spacing,
 * shadow objects, etc.).
 */
import { Platform } from 'react-native';

// ── Colors ────────────────────────────────────────────────────

export const colors = {
  /** Page / screen background (#F2F2F7) */
  backdrop: '#F2F2F7' as const,
  /** Card / surface background (#FFFFFF) */
  surface: '#FFFFFF' as const,
  /** Primary accent (#007AFF) */
  primary: '#007AFF' as const,
  /** Primary pressed state */
  primaryHover: '#0066D6' as const,
  /** Primary glow tint */
  primaryGlow: 'rgba(0, 122, 255, 0.08)' as const,
  /** Secondary purple (#5856D6) */
  secondary: '#5856D6' as const,

  /** Brand green for success states (#34C759) */
  success: '#34C759' as const,
  /** Brand amber for warning states (#FF9500) */
  warning: '#FF9500' as const,
  /** Brand red for danger states (#FF3B30) */
  danger: '#FF3B30' as const,

  /** Status: pending / warning */
  pending: '#FF9500' as const,
  /** Status: approved / success */
  approved: '#34C759' as const,
  /** Status: rejected / danger */
  rejected: '#FF3B30' as const,

  /** Primary text (#000000) */
  textPrimary: '#000000' as const,
  /** Secondary text (#3C3C43) */
  textSecondary: '#3C3C43' as const,
  /** Muted / tertiary text (#8E8E93) */
  textMuted: '#8E8E93' as const,
  /** Text on primary backgrounds (#FFFFFF) */
  textOnPrimary: '#FFFFFF' as const,

  /** Subtle border (rgba(60, 60, 67, 0.10)) */
  border: 'rgba(60, 60, 67, 0.10)' as const,
  /** Active / focused border */
  borderActive: 'rgba(60, 60, 67, 0.20)' as const,
  /** Primary glow border */
  borderGlow: 'rgba(0, 122, 255, 0.20)' as const,
  /** Strong border for dividers */
  borderStrong: 'rgba(60, 60, 67, 0.18)' as const,

  /** Neutral light track (#E5E5EA) */
  neutralLight: '#E5E5EA' as const,
  /** Neutral dark surface (#F2F2F7) */
  neutralDark: '#F2F2F7' as const,

  /** Success background tint */
  successBg: 'rgba(52, 199, 89, 0.10)' as const,
  /** Warning background tint */
  warningBg: 'rgba(255, 149, 0, 0.10)' as const,
  /** Danger background tint */
  dangerBg: 'rgba(255, 59, 48, 0.10)' as const,
} as const;

// ── Typography ─────────────────────────────────────────────────

/** SF-style type scale for the mobile app. */
export const fontSizes = {
  largeTitle: 34,
  title1: 28,
  title2: 22,
  title3: 20,
  headline: 17,
  body: 15,
  callout: 14,
  subheadline: 13,
  footnote: 12,
  caption1: 11,
  caption2: 10,
} as const;

/** Platform-aware font families that mirror SF Pro on iOS. */
export const fonts = {
  heading: Platform.select({
    ios: 'System',
    android: 'Roboto',
    default: 'System',
  }) as string,
  body: Platform.select({
    ios: 'System',
    android: 'Roboto',
    default: 'System',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
} as const;

// ── Spacing ────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

// ── Border Radius ──────────────────────────────────────────────

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 16,
  full: 9999,
} as const;

// ── Shadows ────────────────────────────────────────────────────

/** Apple-style shadow presets for cards and sheets. */
export const shadows = {
  /** Default card shadow — subtle, light */
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  } as const,
  /** Elevated / modal shadow */
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  } as const,
  /** Primary accent glow */
  glow: {
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  } as const,
} as const;

// ── Frosted Glass ──────────────────────────────────────────────

export const glass = {
  /** Light frosted glass background (for light mode) */
  light: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)' as const,
    borderColor: 'rgba(255, 255, 255, 0.6)' as const,
  },
} as const;

// ── Exported composite token object ────────────────────────────

/**
 * Complete mobile design token object matching the shape of
 * `clinicalTokens` from the shared package, but with React Native–
 * friendly values.
 *
 * Screens can consume this directly or via Tailwind classes that
 * reference the underlying values through the theme config.
 */
export const mobileTokens = {
  colors,
  fonts,
  fontSizes,
  spacing,
  radius,
  shadows,
  glass,
} as const;

export type MobileTokens = typeof mobileTokens;
