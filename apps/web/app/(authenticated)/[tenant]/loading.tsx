import CardSkeleton from '@/components/CardSkeleton';

/**
 * P1.11: Tenant layout content loading state.
 * Apple Health design — white cards with shimmer animation.
 */
export default function TenantLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-48 rounded-lg" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
