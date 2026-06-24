export const clinicalTokens = {
  colors: {
    backdrop: { dark: '#060814', light: '#F8FAFC' },
    primary: { DEFAULT: '#0D9488', hover: '#14B8A6', glow: 'rgba(13, 148, 136, 0.35)' },
    secondary: { DEFAULT: '#6366F1', hover: '#818CF8', glow: 'rgba(99, 102, 241, 0.35)' },
    neutral: { light: '#E2E8F0', dark: '#0F172A', darker: '#060814' },
    success: { DEFAULT: '#059669', glow: 'rgba(16, 185, 129, 0.45)' },
    warning: { DEFAULT: '#D97706', glow: 'rgba(245, 158, 11, 0.45)' },
    danger: { DEFAULT: '#DC2626', glow: 'rgba(239, 68, 68, 0.45)' },
    border: { DEFAULT: 'rgba(99, 102, 241, 0.15)', active: 'rgba(99, 102, 241, 0.4)', glow: 'rgba(99, 102, 241, 0.35)' },
    text: { primary: '#F1F5F9', secondary: '#CBD5E1', muted: '#94A3B8', onPrimary: '#FFFFFF' },
    pending: '#FCD34D',
    approved: '#6EE7B7',
    rejected: '#FCA5A5',
  },
  fonts: {
    heading: 'Outfit, sans-serif',
    body: 'Inter, Plus Jakarta Sans, sans-serif',
    mono: 'Geist Mono, JetBrains Mono, monospace',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radius: { sm: 8, md: 12, lg: 16, full: 9999 },
  shadows: {
    panel: '0 4px 30px rgba(6, 8, 20, 0.4)',
    glow: (color: string) => `0 0 8px ${color}`,
    primary: '0 0 8px rgba(13, 148, 136, 0.3)',
    pending: '0 0 8px rgba(252, 211, 77, 0.4)',
    approved: '0 0 8px rgba(110, 231, 183, 0.4)',
    rejected: '0 0 8px rgba(252, 165, 165, 0.4)',
  },
  animation: {
    fast: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
    medium: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    spring: '500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    stagger: 50,
  },
  glass: {
    blur: 12,
    border: 'rgba(255, 255, 255, 0.05)',
    shadow: '0 8px 32px rgba(6, 8, 20, 0.4)',
  },
} as const;

export type ClinicalTokens = typeof clinicalTokens;

export const clinicalFonts = {
  heading: 'Outfit, sans-serif',
  body: 'Inter, Plus Jakarta Sans, sans-serif',
  mono: 'Geist Mono, JetBrains Mono, monospace',
} as const;

export const animationTokens = {
  defaultTransition: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  springSlideUp: { tension: 170, friction: 26 },
  staggerDelay: 50,
} as const;