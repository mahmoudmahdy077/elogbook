export const clinicalColors = {
  backdrop: '#060814',
  panel: '#0F172A',
  primary: '#0D9488',
  secondary: '#6366F1',
  amber: '#D97706',
  emerald: '#059669',
  crimson: '#DC2626',
  neutralLight: '#E2E8F0',
  neutralDark: '#0F172A',
} as const;

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
