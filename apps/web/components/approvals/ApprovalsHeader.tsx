'use client';

import { clinicalTokens } from '@elogbook/shared';
import { StatusBadge } from '@elogbook/shared';

interface ApprovalsHeaderProps {
  pendingCount: number;
}

export function ApprovalsHeader({ pendingCount }: ApprovalsHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <h2
        className="text-xl font-semibold"
        style={{ fontFamily: clinicalTokens.fonts.heading }}
      >
        Pending Approvals
      </h2>
      <StatusBadge status="pending" size="sm">
        {pendingCount}
      </StatusBadge>
    </div>
  );
}