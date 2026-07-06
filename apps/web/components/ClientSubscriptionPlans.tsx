'use client';

import dynamic from 'next/dynamic';

const SubscriptionPlans = dynamic(() => import('@/components/SubscriptionPlans'), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse space-y-4 p-5">
      <div className="h-6 bg-black/10 dark:bg-white/10 rounded w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-black/10 dark:bg-white/10 rounded-2xl" />
        ))}
      </div>
    </div>
  ),
});

interface SubscriptionPlansData {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: string;
  max_residents: number | null;
}

interface ClientSubscriptionPlansProps {
  plans: SubscriptionPlansData[];
  tenantId: string;
  gatewayProvider: string | null;
  publishableKey: string | null;
  currentPlanId: string | null;
}

export default function ClientSubscriptionPlans({
  plans,
  tenantId,
  gatewayProvider,
  publishableKey,
  currentPlanId,
}: ClientSubscriptionPlansProps) {
  return (
    <SubscriptionPlans
      plans={plans}
      tenantId={tenantId}
      gatewayProvider={gatewayProvider}
      publishableKey={publishableKey}
      currentPlanId={currentPlanId}
    />
  );
}
