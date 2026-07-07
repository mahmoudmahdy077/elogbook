import type { Config } from 'tailwindcss';
import { clinicalTokens } from '@elogbook/shared';

const { colors, fonts, spacing, radius, animation, glass } = clinicalTokens;

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '../packages/shared/src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Apple Health tokens — light-first
        backdrop: colors.backdrop.dark,
        surface: 'rgba(255, 255, 255, 0.72)',
        'surface-solid': colors.neutral.darker,
        primary: colors.primary.DEFAULT,
        'primary-hover': colors.primary.hover,
        'primary-glow': colors.primary.glow,
        secondary: colors.secondary.DEFAULT,
        'secondary-hover': colors.secondary.hover,
        'secondary-glow': colors.secondary.glow,
        'neutral-light': colors.neutral.light,
        'neutral-dark': colors.neutral.dark,
        'neutral-darker': colors.neutral.darker,
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

        // HeroUI semantic color scales
        default: {
          50: '#f8f8fa',
          100: '#f2f2f7',
          200: '#e5e5ea',
          300: '#d1d1d6',
          400: '#aeaeb2',
          500: '#6d6d73',
          600: '#636366',
          700: '#48484a',
          800: '#3a3a3c',
          900: '#1c1c1e',
        },
        success: {
          50: 'rgba(52, 199, 89, 0.10)',
          100: 'rgba(52, 199, 89, 0.18)',
          200: 'rgba(52, 199, 89, 0.25)',
          300: 'rgba(52, 199, 89, 0.35)',
          400: '#30d158',
          500: '#34c759',
          600: '#28a745',
          DEFAULT: '#34c759',
          700: '#1e7e34',
          800: '#155724',
          900: '#0d3616',
        },
        warning: {
          50: 'rgba(255, 149, 0, 0.10)',
          100: 'rgba(255, 149, 0, 0.18)',
          200: 'rgba(255, 149, 0, 0.25)',
          300: 'rgba(255, 149, 0, 0.35)',
          400: '#ff9f0a',
          500: '#ff9500',
          600: '#e68600',
          DEFAULT: '#ff9500',
          700: '#bf6e00',
          800: '#8a5000',
          900: '#553200',
        },
        danger: {
          50: 'rgba(255, 59, 48, 0.10)',
          100: 'rgba(255, 59, 48, 0.18)',
          200: 'rgba(255, 59, 48, 0.25)',
          300: 'rgba(255, 59, 48, 0.35)',
          400: '#ff453a',
          500: '#ff3b30',
          600: '#e0352b',
          DEFAULT: '#ff3b30',
          700: '#b82c23',
          800: '#8a211a',
          900: '#5c1611',
        },
        divider: 'rgba(60, 60, 67, 0.08)',
      },
      fontFamily: {
        heading: [fonts.heading],
        sans: [fonts.body],
        mono: [fonts.mono],
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
        full: `${radius.full}px`,
      },
      boxShadow: {
        panel: 'none',
        primary: 'none',
        pending: 'none',
        approved: 'none',
        rejected: 'none',
      },
      transitionDuration: {
        fast: '200ms',
        medium: '300ms',
        spring: '350ms',
      },
      transitionTimingFunction: {
        fast: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        medium: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        spring: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      },
      backdropBlur: {
        glass: `${glass.blur}px`,
      },
    },
  },
  plugins: [],
};

export default config;