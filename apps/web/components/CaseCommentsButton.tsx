'use client';

import { useState } from 'react';
import CaseComments from './CaseComments';

export default function CaseCommentsButton({
  caseEntryId,
  tenantId,
  currentUserId,
}: {
  caseEntryId: string;
  tenantId: string;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Comments</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Notes between the resident and supervisors on this case.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center min-h-[40px] rounded-full border border-border px-4 text-sm font-medium text-text-secondary hover:bg-backdrop transition-colors"
        >
          Open comments
        </button>
      </div>

      <CaseComments
        caseEntryId={caseEntryId}
        tenantId={tenantId}
        currentUserId={currentUserId}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
