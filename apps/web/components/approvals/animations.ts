'use client';

import { Variants } from 'framer-motion';

export const itemVariants: Variants = {
  enter: { opacity: 0, y: 16 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -16 },
};

export const itemTransition = {
  duration: 0.2,
  ease: 'easeOut' as const,
};

export const kpiCounterAnimation = {
  duration: 0.6,
  ease: 'easeOut' as const,
};

export const staggerDelay = 0.05;