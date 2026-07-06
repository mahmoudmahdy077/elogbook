import CardSkeleton from '@/components/CardSkeleton';
import TableSkeleton from '@/components/TableSkeleton';

/**
 * P1.11: Approvals loading state.
 * Apple Health design — filter skeleton + approval cards/table skeleton.
 */
export default function ApprovalsLoading() {
  return (
    <div className="space-y-6">
      {/* Page title skeleton */}
      <div className="h-7 w-36 rounded-lg" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
      {/* Filter chips skeleton */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-full" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
        ))}
      </div>
      {/* Summary card skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={`stat-${i}`} />
        ))}
      </div>
      {/* Approval cards/table skeleton */}
      <div className="rounded-2xl border border-[--color-border]" style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(20px)' }}>
        <TableSkeleton columns={4} rows={6} />
      </div>
    </div>
  );
}
