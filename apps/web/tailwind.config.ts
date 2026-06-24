import type { Config } from 'tailwindcss';
import { clinicalTokens } from '@elogbook/shared/src/constants/design-tokens';

const { colors, fonts, spacing, radius, shadows, animation, glass } = clinicalTokens;

const config: Config = {
  theme: {
    extend: {
      colors: {
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