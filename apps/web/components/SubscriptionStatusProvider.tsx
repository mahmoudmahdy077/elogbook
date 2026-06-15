'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';

type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled';

interface SubscriptionStatusValue {
  status: SubscriptionStatus;
  isReadOnly: boolean;
  isGracePeriod: boolean;
  daysUntilSuspension: number | null;
}

const SubscriptionStatusContext = createContext<SubscriptionStatusValue | null>(null);

interface SubscriptionStatusProviderProps {
  children: ReactNode;
  status: SubscriptionStatus;
  periodEnd?: string | null;
}

const GRACE_PERIOD_DAYS = 30;

export function SubscriptionStatusProvider({ children, status, periodEnd }: SubscriptionStatusProviderProps) {
  const value = useMemo(() => {
    const isReadOnly = status === 'past_due' || status === 'unpaid';
    const isGracePeriod = isReadOnly;
    let daysUntilSuspension: number | null = null;
    if (isGracePeriod && periodEnd) {
      const end = new Date(periodEnd);
      const diff = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000 - (Date.now() - end.getTime());
      daysUntilSuspension = Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
    }
    return { status, isReadOnly, isGracePeriod, daysUntilSuspension };
  }, [status, periodEnd]);

  return (
    <SubscriptionStatusContext.Provider value={value}>
      {children}
    </SubscriptionStatusContext.Provider>
  );
}

export function useSubscriptionStatus(): SubscriptionStatusValue {
  const ctx = useContext(SubscriptionStatusContext);
  if (!ctx) {
    return { status: 'active', isReadOnly: false, isGracePeriod: false, daysUntilSuspension: null };
  }
  return ctx;
}
