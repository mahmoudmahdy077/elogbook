'use client';

import { clinicalTokens } from '@elogbook/shared';
import { Panel, StatusBadge } from '@elogbook/shared';
import ApprovalActions from '@/components/ApprovalActions';
import { PendingEntry } from './useApprovalsData';

interface PendingCaseCardProps {
  entry: PendingEntry;
  tenantSlug: string;
}

export function PendingCaseCard({ entry, tenantSlug }: PendingCaseCardProps) {
  const profile = entry.profiles[0];
  const template = entry.case_templates[0];
  const approvalRequest = entry.approval_requests[0];
  const fields = entry.field_values || {};
  const fieldEntries = Object.entries(fields).slice(0, 4);

  return (
    <Panel className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <p className="text-sm font-semibold truncate">
            {profile?.full_name || 'Unknown Resident'}
          </p>
          <p className="text-xs text-neutral-light/50">
            {profile?.specialty || 'No specialty'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge
            status={entry.is_deidentified ? 'deidentified' : 'pending'}
            size="sm"
          >
            {entry.is_deidentified ? 'De-ID' : 'PII'}
          </StatusBadge>
          <StatusBadge status="pending" size="sm">
            Pending
          </StatusBadge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-neutral-light/50 block text-xs">Template</span>
          <span className="font-medium">
            {template?.specialty}
            {template?.name ? ` – ${template.name}` : ''}
          </span>
        </div>
        <div>
          <span className="text-neutral-light/50 block text-xs">Case Date</span>
          <span className="clinical-data text-sm" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {entry.case_date || '-'}
          </span>
        </div>
      </div>

      {fieldEntries.length > 0 && (
        <div className="border-t border-border pt-3">
          <span className="text-xs text-neutral-light/50 block mb-2">Field Values</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {fieldEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <span className="text-xs text-neutral-light/50 truncate">{key}</span>
                <span className="text-xs font-medium truncate">
                  {value === null || value === '' ? '-' : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {approvalRequest && (
        <div className="border-t border-border pt-4">
          <ApprovalActions
            requestId={approvalRequest.id}
            entryId={entry.id}
            tenant={tenantSlug}
          />
        </div>
      )}
    </Panel>
  );
}