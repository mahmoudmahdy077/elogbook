'use client';

import Link from 'next/link';

interface CasePaginationProps {
  nextCursor: string | null;
  hasMore: boolean;
  tenantSlug: string;
  isLoading?: boolean;
}

export default function CasePagination({ nextCursor, hasMore, tenantSlug, isLoading }: CasePaginationProps) {
  if (!hasMore) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-sm text-text-muted">No more cases</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-6">
      <Link
        href={`/${tenantSlug}/cases?cursor=${nextCursor}`}
        className={`inline-flex items-center rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium transition-opacity ${
          isLoading ? 'opacity-50 pointer-events-none' : 'hover:opacity-90'
        }`}
      >
        Load More
      </Link>
    </div>
  );
}
