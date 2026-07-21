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
      <div className="h-7 w-32 rounded-lg bg-default-200 animate-pulse" />
      {/* Filter bar skeleton */}
      <div className="flex gap-3 items-center">
        <div className="h-9 w-48 rounded-xl bg-default-200 animate-pulse" />
        <div className="h-9 w-28 rounded-xl bg-default-200 animate-pulse" />
      </div>
      {/* Summary card skeleton */}
      <CardSkeleton />
      {/* Table skeleton */}
      <div className="rounded-2xl bg-surface border border-border">
        <TableSkeleton columns={5} rows={8} />
      </div>
    </div>
  );
}
