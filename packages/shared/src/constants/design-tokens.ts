export const clinicalTokens = {
  colors: {
    backdrop: { dark: '#F2F2F7', light: '#FFFFFF' },
    primary: { DEFAULT: '#007AFF', hover: '#0066D6', glow: 'rgba(0, 122, 255, 0.08)' },
    secondary: { DEFAULT: '#5856D6', hover: '#6E6CF0', glow: 'rgba(88, 86, 214, 0.08)' },
    neutral: { light: '#E5E5EA', dark: '#F2F2F7', darker: '#FFFFFF' },
    success: { DEFAULT: '#34C759', bg: 'rgba(52, 199, 89, 0.10)', glow: 'rgba(52, 199, 89, 0.08)' },
    warning: { DEFAULT: '#FF9500', bg: 'rgba(255, 149, 0, 0.10)', glow: 'rgba(255, 149, 0, 0.08)' },
    danger: { DEFAULT: '#FF3B30', bg: 'rgba(255, 59, 48, 0.10)', glow: 'rgba(255, 59, 48, 0.08)' },
    border: {
      DEFAULT: 'rgba(60, 60, 67, 0.10)',
      active: 'rgba(60, 60, 67, 0.20)',
      glow: 'rgba(0, 122, 255, 0.20)',
      strong: 'rgba(60, 60, 67, 0.18)',
    },
    text: { primary: '#000000', secondary: '#3C3C43', muted: '#6D6D73', onPrimary: '#FFFFFF' },
    pending: '#FF9500',
    approved: '#34C759',
    rejected: '#FF3B30',
  },
  fonts: {
    heading: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radius: { sm: 8, md: 10, lg: 14, xl: 18, full: 9999 },
  shadows: {
    panel: 'none',
    glow: (_color: string) => 'none',
    primary: 'none',
    pending: 'none',
    approved: 'none',
    rejected: 'none',
  },
  glass: {
    bg: 'rgba(255, 255, 255, 0.72)',
    blur: 20,
    border: 'rgba(255, 255, 255, 0.6)',
    shadow: 'none',
  },
  animation: {
    fast: '200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    medium: '300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    spring: '350ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    stagger: 30,
  },
} as const;

export type ClinicalTokens = typeof clinicalTokens;

export const clinicalFonts = {
  heading: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  mono: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
} as const;

export const animationTokens = {
  defaultTransition: '200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
  springSlideUp: { tension: 170, friction: 26 },
  staggerDelay: 30,
} as const;