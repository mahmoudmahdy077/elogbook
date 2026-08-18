'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QuickAddFAB from '@/components/QuickAddFAB';
import QuickAddCase from '@/components/QuickAddCase';

interface QuickAddWrapperProps {
  tenantSlug: string;
}

export default function QuickAddWrapper({ tenantSlug }: QuickAddWrapperProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <QuickAddFAB onClick={() => setIsOpen(true)} />
      <QuickAddCase
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSaved={() => router.refresh()}
        tenantSlug={tenantSlug}
      />
    </>
  );
}
