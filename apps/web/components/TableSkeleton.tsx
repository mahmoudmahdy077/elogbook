'use client';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export default function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="panel p-4 space-y-4">
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={`h-${i}`} className="h-4 flex-1 rounded animate-pulse bg-default-200" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }).map((_, col) => (
            <div key={`${row}-${col}`} className="h-4 flex-1 rounded animate-pulse bg-default-200" />
          ))}
        </div>
      ))}
    </div>
  );
}
