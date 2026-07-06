'use client';

export default function CardSkeleton() {
  return (
    <div className="panel p-6 space-y-4">
      <div className="h-6 w-2/5 rounded animate-pulse bg-default-200" />
      <div className="h-4 w-full rounded animate-pulse bg-default-200" />
      <div className="h-4 w-3/4 rounded animate-pulse bg-default-200" />
    </div>
  );
}
