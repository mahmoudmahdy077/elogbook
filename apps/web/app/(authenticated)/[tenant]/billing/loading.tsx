import CardSkeleton from '@/components/CardSkeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-surface rounded-lg animate-pulse" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
