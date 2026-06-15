'use client';

import { Skeleton } from '@heroui/react';

export default function CardSkeleton() {
  return (
    <div className="panel p-6 space-y-4">
      <Skeleton className="h-6 w-2/5 rounded" />
      <Skeleton className="h-4 w-full rounded" />
      <Skeleton className="h-4 w-3/4 rounded" />
    </div>
  );
}