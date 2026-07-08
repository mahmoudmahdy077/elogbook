import CardSkeleton from '@/components/CardSkeleton';

export default function EvaluationsLoading() {
  return (
    <div className="space-y-7">
      <div>
        <div className="h-10 w-40 rounded animate-pulse bg-default-200" />
        <div className="h-4 w-56 mt-2 rounded animate-pulse bg-default-200" />
      </div>
      <div className="flex gap-3">
        <div className="h-10 w-44 rounded-xl animate-pulse bg-default-200" />
        <div className="h-10 w-36 rounded-xl animate-pulse bg-default-200" />
        <div className="h-10 w-40 rounded-full animate-pulse bg-default-200" />
      </div>
      <div className="grid grid-cols-1 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
