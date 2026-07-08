import CardSkeleton from '@/components/CardSkeleton';

export default function MilestonesLoading() {
  return (
    <div className="space-y-7">
      <div>
        <div className="h-10 w-44 rounded animate-pulse bg-default-200" />
        <div className="h-4 w-56 mt-2 rounded animate-pulse bg-default-200" />
      </div>
      <div className="flex gap-3">
        <div className="h-10 w-52 rounded-xl animate-pulse bg-default-200" />
        <div className="h-10 w-40 rounded-full animate-pulse bg-default-200" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <CardSkeleton />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
