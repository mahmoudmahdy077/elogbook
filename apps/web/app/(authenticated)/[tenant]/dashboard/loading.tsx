import CardSkeleton from '@/components/CardSkeleton';

/**
 * P1.11: Dashboard loading state.
 * Apple Health design — KPI stat cards + content grid + quick links skeletons.
 * Matches the Suspense fallback layout in dashboard/page.tsx.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-7 p-6">
      {/* KPI stat cards skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={`kpi-${i}`} />
        ))}
      </div>
      {/* Main content grid skeleton — two columns on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      {/* Quick links skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={`link-${i}`} />
        ))}
      </div>
    </div>
  );
}
