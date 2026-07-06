import CardSkeleton from '@/components/CardSkeleton';
import TableSkeleton from '@/components/TableSkeleton';

/**
 * P1.11: Cases list loading state.
 * Apple Health design — filter bar skeleton + table skeleton.
 */
export default function CasesLoading() {
  return (
    <div className="space-y-6">
      {/* Page title skeleton */}
      <div className="h-7 w-32 rounded-lg" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
      {/* Filter bar skeleton */}
      <div className="flex gap-3 items-center">
        <div className="h-9 w-48 rounded-xl" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
        <div className="h-9 w-28 rounded-xl" style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
      </div>
      {/* Summary card skeleton */}
      <CardSkeleton />
      {/* Table skeleton */}
      <div className="rounded-2xl border border-[--color-border]" style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(20px)' }}>
        <TableSkeleton columns={5} rows={8} />
      </div>
    </div>
  );
}
