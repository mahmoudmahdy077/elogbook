'use client';

import { Button } from '@heroui/react';
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
        <p className="text-sm text-default-500">No more cases</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-6">
      <Link href={`/${tenantSlug}/cases?cursor=${nextCursor}`}>
        <Button
          variant="primary"
          size="md"
          isDisabled={isLoading}
        >
          Load More
        </Button>
      </Link>
    </div>
  );
}