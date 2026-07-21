import CardSkeleton from '@/components/CardSkeleton';

/**
 * P1.11: Tenant layout content loading state.
 * Apple Health design — white cards with shimmer animation.
 */
export default function TenantLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-48 rounded-lg bg-default-200 animate-pulse" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
