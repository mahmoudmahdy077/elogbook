import CardSkeleton from '@/components/CardSkeleton';

export default function RotationsLoading() {
  return (
    <div className="space-y-7">
      <div>
        <div className="h-10 w-32 rounded animate-pulse bg-default-200" />
        <div className="h-4 w-48 mt-2 rounded animate-pulse bg-default-200" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
