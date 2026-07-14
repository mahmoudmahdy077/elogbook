/** @type {import('tailwindcss').Config} */
/* eslint-disable @typescript-eslint/no-require-imports */
const { clinicalTokens } = require('@elogbook/shared/src/design-tokens.config.cjs');

const { colors, fonts, spacing, radius, shadows, animation, glass } = clinicalTokens;

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        backdrop: colors.backdrop.dark,
        panel: colors.neutral.dark,
        primary: colors.primary.DEFAULT,
        'primary-hover': colors.primary.hover,
        'primary-glow': colors.primary.glow,
        secondary: colors.secondary.DEFAULT,
        'secondary-hover': colors.secondary.hover,
        'secondary-glow': colors.secondary.glow,
        amber: colors.warning.DEFAULT,
        emerald: colors.success.DEFAULT,
        crimson: colors.danger.DEFAULT,
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
        body: [fonts.body],
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