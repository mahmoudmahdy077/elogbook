'use client';

import Link from 'next/link';
import { useSubscriptionStatus } from '@/components/SubscriptionStatusProvider';

export default function ReadOnlyBanner({ tenantSlug }: { tenantSlug: string }) {
  const { isReadOnly, daysUntilSuspension } = useSubscriptionStatus();

  if (!isReadOnly) return null;

  return (
    <div
      role="alert"
      className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-amber-200">
          <span className="font-semibold">Subscription renewal required</span>
          {' — '}
          Logging is temporarily disabled.
          {daysUntilSuspension !== null && (
            <span className="ml-1">Account will be suspended in {daysUntilSuspension} day{daysUntilSuspension === 1 ? '' : 's'}.</span>
          )}
        </p>
        <Link
          href={`/${tenantSlug}/billing`}
          className="text-sm font-medium text-amber-200 underline hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
        >
          Renew now to restore full access
        </Link>
      </div>
    </div>
  );
}
