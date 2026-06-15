export const DEFAULT_TRANSITION = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
} as const;

export const SPRING_SLIDE_UP = {
  type: 'spring' as const,
  stiffness: 170,
  damping: 26,
} as const;

export const STAGGER_DELAY = 0.05;

export const CARD_EXIT_ANIMATION = {
  x: -300,
  opacity: 0,
  transition: { duration: 0.3 },
} as const;

export const KPI_COUNT_UP = {
  duration: 1.5,
  ease: 'easeOut' as const,
} as const;
