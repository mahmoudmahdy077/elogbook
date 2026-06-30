import type { Config } from 'tailwindcss';
import { clinicalTokens } from '@elogbook/shared';

const { colors, fonts, spacing, radius, shadows, animation, glass } = clinicalTokens;

const config: Config = {
  theme: {
    extend: {
      colors: {
        // Core clinical tokens
        backdrop: colors.backdrop.dark,
        surface: 'rgba(15, 23, 42, 0.8)',
        'surface-solid': colors.neutral.dark,
        primary: colors.primary.DEFAULT,
        'primary-hover': colors.primary.hover,
        'primary-glow': colors.primary.glow,
        secondary: colors.secondary.DEFAULT,
        'secondary-hover': colors.secondary.hover,
        'secondary-glow': colors.secondary.glow,
        'neutral-light': colors.neutral.light,
        'neutral-dark': colors.neutral.dark,
        border: colors.border.DEFAULT,
        'border-active': colors.border.active,
        'border-glow': colors.border.glow,
        'text-primary': colors.text.primary,
        'text-secondary': colors.text.secondary,
        'text-muted': colors.text.muted,
        'text-on-primary': colors.text.onPrimary,
        pending: colors.pending,
        approved: colors.approved,
        rejected: colors.rejected,
        'amber-glow': colors.warning.glow,
        'emerald-glow': colors.success.glow,
        'crimson-glow': colors.danger.glow,

        // HeroUI semantic color scales (U1.0) — required for HeroUI
        // components to render with proper colors. Without these,
        // classes like text-default-500, bg-danger-50, border-divider
        // produce invisible/no-op output.
        default: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: {
          50: 'rgba(5, 150, 105, 0.1)',
          100: 'rgba(5, 150, 105, 0.2)',
          200: 'rgba(5, 150, 105, 0.3)',
          300: 'rgba(5, 150, 105, 0.4)',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          DEFAULT: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        warning: {
          50: 'rgba(217, 119, 6, 0.1)',
          100: 'rgba(217, 119, 6, 0.2)',
          200: 'rgba(217, 119, 6, 0.3)',
          300: 'rgba(217, 119, 6, 0.4)',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          DEFAULT: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        danger: {
          50: 'rgba(220, 38, 38, 0.1)',
          100: 'rgba(220, 38, 38, 0.2)',
          200: 'rgba(220, 38, 38, 0.3)',
          300: 'rgba(220, 38, 38, 0.4)',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          DEFAULT: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        divider: 'rgba(99, 102, 241, 0.12)',
      },
      fontFamily: {
        heading: [fonts.heading],
        sans: [fonts.body],
        mono: [fonts.mono],
      },
      spacing: {
        xs: `${spacing.xs}px`,
        sm: `${spacing.sm}px`,
        md: `${spacing.md}px`,
        lg: `${spacing.lg}px`,
        xl: `${spacing.xl}px`,
        '2xl': `${spacing['2xl']}px`,
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        full: `${radius.full}px`,
      },
      boxShadow: {
        panel: shadows.panel,
        glow: (value: { opacityValue: number }) => shadows.glow(`rgba(99, 102, 241, ${value.opacityValue})`),
        primary: shadows.primary,
        pending: shadows.pending,
        approved: shadows.approved,
        rejected: shadows.rejected,
      },
      transitionDuration: {
        fast: animation.fast.split(' ')[0],
        medium: animation.medium.split(' ')[0],
        spring: animation.spring.split(' ')[0],
      },
      transitionTimingFunction: {
        fast: animation.fast.split(' ').slice(1).join(' '),
        medium: animation.medium.split(' ').slice(1).join(' '),
        spring: animation.spring.split(' ').slice(1).join(' '),
      },
      backdropBlur: {
        glass: `${glass.blur}px`,
      },
    },
  },
  plugins: [],
};

export default config;