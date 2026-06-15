'use client';

import { ToastProvider } from '@/components/Toast';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
