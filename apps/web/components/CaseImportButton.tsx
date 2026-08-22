'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CaseImport from '@/components/CaseImport';

interface CaseImportButtonProps {
  tenantId: string;
  residentId: string;
}

/** Toolbar button + modal wrapper that mounts the (previously unreachable)
 *  CSV case-import feature on the cases list page. */
export default function CaseImportButton({ tenantId, residentId }: CaseImportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-black/10 bg-white text-sm font-medium text-[#3C3C43] hover:bg-black/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M3 3.5A1.5 1.5 0 014.5 2h6.379a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0116.5 7.62V16.5A1.5 1.5 0 0115 18H4.5A1.5 1.5 0 013 16.5v-13zM8.75 9.25v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5a.75.75 0 011.5 0z" />
        </svg>
        Import CSV
      </button>
      {isOpen && (
        <CaseImport
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          tenantId={tenantId}
          residentId={residentId}
        />
      )}
    </>
  );
}
