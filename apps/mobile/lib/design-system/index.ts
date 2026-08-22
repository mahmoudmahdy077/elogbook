/**
 * Apple Health Design System — E-Logbook Mobile.
 *
 * Cycle 8: Consistent spacing, typography, color palette, loading states,
 * empty states, and animation tokens. Enforces the clinical/medical
 * aesthetic that Mahmoud specified (no glow/shadow, blue accent, clean).
 *
 * Design principles:
 * - Zero shadows, zero glow effects (anti-"gamic")
 * - Blue accent: #007AFF (Apple Health standard)
 * - Clean, clinical, professional
 * - Consistent 4px spacing grid
 * - Accessible (WCAG 2.1 AA minimum contrast)
 */

// ---------------------------------------------------------------------------
// 1. Spacing System (4px grid)
// ---------------------------------------------------------------------------

export const spacing = {
  /** 0px */
  none: 0,
  /** 2px — micro spacing */
  xs: 2,
  /** 4px */
  sm: 4,
  /** 8px */
  md: 8,
  /** 12px */
  lg: 12,
  /** 16px — standard padding */
  xl: 16,
  /** 20px */
  '2xl': 20,
  /** 24px — section spacing */
  '3xl': 24,
  /** 32px — large section spacing */
  '4xl': 32,
  /** 40px */
  '5xl': 40,
  /** 48px — page-level spacing */
  '6xl': 48,
} as const;

// ---------------------------------------------------------------------------
// 2. Typography Scale
// ---------------------------------------------------------------------------

export const typography = {
  /** Large title — screen headers */
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  /** Section headers */
  h2: {
    fontSize: 22,
    fontWeight: '600' as const,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  /** Subsection headers */
  h3: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  /** Card titles, list headers */
  h4: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
    letterSpacing: 0,
  },
  /** Body text */
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
    letterSpacing: 0,
  },
  /** Secondary body text */
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    letterSpacing: 0,
  },
  /** Captions, timestamps */
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  /** Tab bar, buttons */
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  /** Monospace for IDs, codes */
  mono: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    fontFamily: 'GeistMono-Regular',
    letterSpacing: 0,
  },
} as const;

// ---------------------------------------------------------------------------
// 3. Color Palette (Apple Health-inspired, clinical)
// ---------------------------------------------------------------------------

export const colors = {
  // Primary
  primary: '#007AFF',       // Apple blue
  primaryLight: '#4DA3FF',
  primaryDark: '#0055CC',

  // Backgrounds
  background: '#FFFFFF',
  backgroundSecondary: '#F2F2F7',
  backgroundTertiary: '#E5E5EA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  // Text
  textPrimary: '#1C1C1E',
  textSecondary: '#6C6C70',
  textTertiary: '#AEAEB2',
  textInverse: '#FFFFFF',

  // Status (medical context)
  success: '#34C759',       // Approved/complete
  warning: '#FF9500',       // Pending review
  error: '#FF3B30',         // Rejected/error
  info: '#5AC8FA',          // Informational

  // Borders
  border: '#C6C6C8',
  borderLight: '#E5E5EA',
  separator: '#3C3C4340',   // 24% opacity

  // Semantic
  approved: '#34C759',
  pending: '#FF9500',
  rejected: '#FF3B30',
  draft: '#8E8E93',

  // Sync status
  synced: '#34C759',
  syncing: '#007AFF',
  offline: '#8E8E93',
  error_sync: '#FF3B30',

  // Overlay
  overlay: '#00000040',
  modalBackground: '#FFFFFF',
} as const;

// ---------------------------------------------------------------------------
// 4. Border Radius
// ---------------------------------------------------------------------------

export const borderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// 5. Shadows (minimal — Apple Health style)
// ---------------------------------------------------------------------------

/**
 * Note: Mahmoud explicitly rejected glow/drop-shadow effects.
 * These are subtle elevation hints only, not decorative.
 */
export const shadows = {
  none: {},
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
} as const;

// ---------------------------------------------------------------------------
// 6. Loading States
// ---------------------------------------------------------------------------

export const loadingStates = {
  /** Skeleton shimmer placeholder */
  skeleton: {
    backgroundColor: '#E5E5EA',
    borderRadius: borderRadius.md,
  },
  /** Inline spinner */
  spinner: {
    size: 'small' as const,
    color: colors.primary,
  },
  /** Full-screen loading */
  fullscreen: {
    backgroundColor: colors.background,
    centered: true,
  },
} as const;

// ---------------------------------------------------------------------------
// 7. Empty States
// ---------------------------------------------------------------------------

export interface EmptyStateConfig {
  icon: string;       // Ionicons name
  title: string;
  description: string;
  actionLabel?: string;
}

export const emptyStates: Record<string, EmptyStateConfig> = {
  noCases: {
    icon: 'document-text-outline',
    title: 'No Cases Yet',
    description: 'Start logging your clinical cases to track your progress.',
    actionLabel: 'Log First Case',
  },
  noTemplates: {
    icon: 'albums-outline',
    title: 'No Templates Available',
    description: 'Templates will appear here once your program director creates them.',
  },
  noGoals: {
    icon: 'flag-outline',
    title: 'No Program Goals',
    description: 'Your program director will set goals for your specialty.',
  },
  noRotations: {
    icon: 'swap-horizontal-outline',
    title: 'No Rotations Scheduled',
    description: 'Rotations will appear here when assigned.',
  },
  noMilestones: {
    icon: 'trophy-outline',
    title: 'No Milestones Yet',
    description: 'Complete cases to unlock competency milestones.',
  },
  noEvaluations: {
    icon: 'clipboard-outline',
    title: 'No Evaluations',
    description: 'Evaluation forms from supervisors will appear here.',
  },
  noShifts: {
    icon: 'time-outline',
    title: 'No Duty Hours Logged',
    description: 'Track your duty hours to maintain compliance.',
  },
  offline: {
    icon: 'cloud-offline-outline',
    title: 'You\'re Offline',
    description: 'Your changes will sync when you reconnect.',
  },
  syncError: {
    icon: 'sync-outline',
    title: 'Sync Issue',
    description: 'There was a problem syncing. Retrying automatically...',
  },
  rateLimited: {
    icon: 'hourglass-outline',
    title: 'Slow Down',
    description: 'You\'re making changes too quickly. Please wait a moment.',
  },
};

// ---------------------------------------------------------------------------
// 8. Animation Tokens
// ---------------------------------------------------------------------------

export const animation = {
  /** Fast transitions (micro-interactions) */
  fast: 150,
  /** Normal transitions (screen navigation) */
  normal: 300,
  /** Slow transitions (modals, sheets) */
  slow: 500,
  /** Spring animation config */
  spring: {
    damping: 20,
    stiffness: 200,
    mass: 1,
  },
} as const;

// ---------------------------------------------------------------------------
// 9. Layout Constants
// ---------------------------------------------------------------------------

export const layout = {
  /** Screen horizontal padding */
  screenPadding: spacing.xl,
  /** Card padding */
  cardPadding: spacing.lg,
  /** List item height */
  listItemHeight: 56,
  /** Header height */
  headerHeight: 44,
  /** Tab bar height */
  tabBarHeight: 83,
  /** Touch target minimum (accessibility) */
  touchTargetMin: 44,
  /** Maximum content width */
  maxContentWidth: 600,
} as const;

// ---------------------------------------------------------------------------
// 10. Style Presets
// ---------------------------------------------------------------------------

export const presets = {
  /** Standard screen container */
  screen: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  /** Card within a list */
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  /** Primary action button */
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center' as const,
  },
  /** Secondary/outline button */
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  /** Input field */
  input: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  /** Section header */
  sectionHeader: {
    ...typography.h4,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
} as const;
