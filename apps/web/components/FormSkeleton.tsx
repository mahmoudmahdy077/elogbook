'use client';

interface FormSkeletonProps {
  fields?: number;
}

export default function FormSkeleton({ fields = 5 }: FormSkeletonProps) {
  return (
    <div className="panel p-6 space-y-5">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-1/4 rounded animate-pulse bg-default-200" />
          <div className="h-10 w-full rounded-lg animate-pulse bg-default-200" />
        </div>
      ))}
    </div>
  );
}
