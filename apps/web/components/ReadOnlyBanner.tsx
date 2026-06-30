'use client';

import Link from 'next/link';
import { useSubscriptionStatus } from '@/components/SubscriptionStatusProvider';

export default function ReadOnlyBanner({ tenantSlug }: { tenantSlug: string }) {
  const { isReadOnly, daysUntilSuspension } = useSubscriptionStatus();

  if (!isReadOnly) return null;

  return (
    <div
      role="alert"
      className="bg-pending/10 border-b border-pending/30 px-4 py-3"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-pending/80">
          <span className="font-semibold">Subscription renewal required</span>
          {' — '}
          Logging is temporarily disabled.
          {daysUntilSuspension !== null && (
            <span className="ml-1">Account will be suspended in {daysUntilSuspension} day{daysUntilSuspension === 1 ? '' : 's'}.</span>
          )}
        </p>
        <Link
          href={`/${tenantSlug}/billing`}
          className="text-sm font-medium text-pending/80 underline hover:text-pending focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pending-glow rounded"
        >
          Renew now to restore full access
        </Link>
      </div>
    </div>
  );
}
