'use client';

import { MotionConfig } from 'framer-motion';
import { ToastProvider } from '@/components/Toast';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  // reducedMotion="user" makes every framer-motion animation honour the OS
  // prefers-reduced-motion setting, including the components that never called
  // useReducedMotion themselves.
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>{children}</ToastProvider>
    </MotionConfig>
  );
}
