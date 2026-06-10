'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ApprovalActions from '@/components/ApprovalActions';

interface Props {
  tenantId: string;
  tenantSlug: string;
}

interface RelationProfile {
  full_name: string;
  specialty: string | null;
}

interface RelationTemplate {
  specialty: string;
  name: string;
}

interface RelationApprovalRequest {
  id: string;
  status: string;
  requested_at: string;
  comment: string | null;
}

interface PendingEntry {
  id: string;
  case_date: string;
  field_values: Record<string, unknown>;
  is_deidentified: boolean;
  status: string;
  resident_id: string;
  template_id: string;
  tenant_id: string;
  created_at: string;
  profiles: RelationProfile[];
  case_templates: RelationTemplate[];
  approval_requests: RelationApprovalRequest[];
}

const itemVariants = {
  enter: { opacity: 0, y: 16 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -16 },
};

export default function ApprovalsDashboard({ tenantId, tenantSlug }: Props) {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());

  const fetchPending = async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('case_entries')
      .select(
        'id, case_date, field_values, is_deidentified, status, resident_id, template_id, tenant_id, created_at, profiles:resident_id(full_name, specialty), case_templates:template_id(specialty, name), approval_requests:entry_id(id, status, requested_at, comment)'
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    setEntries((data as PendingEntry[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const pendingCount = entries.length;

  if (loading) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-neutral-light/50">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2
          className="text-xl font-semibold"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Pending Approvals
        </h2>
        <span className="badge-pending px-3 py-1 text-xs font-semibold rounded-full">
          {pendingCount}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm text-neutral-light/50">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {entries.map((entry, index) => {
              const profile = entry.profiles[0];
              const template = entry.case_templates[0];
              const approvalRequest = entry.approval_requests[0];
              const fields = entry.field_values || {};
              const fieldEntries = Object.entries(fields).slice(0, 4);

              return (
                <motion.div
                  key={entry.id}
                  variants={itemVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    duration: 0.2,
                    ease: 'easeOut',
                  }}
                >
                  <div className="panel p-5 space-y-4">
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
                        <span
                          className={
                            entry.is_deidentified
                              ? 'badge-approved px-2 py-0.5 text-[10px] font-semibold rounded'
                              : 'badge-pending px-2 py-0.5 text-[10px] font-semibold rounded'
                          }
                        >
                          {entry.is_deidentified ? 'De-ID' : 'PII'}
                        </span>
                        <span className="badge-draft px-2 py-0.5 text-[10px] font-semibold rounded">
                          Pending
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-neutral-light/40 block text-xs">
                          Template
                        </span>
                        <span className="font-medium">
                          {template?.specialty}
                          {template?.name ? ` – ${template.name}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-light/40 block text-xs">
                          Case Date
                        </span>
                        <span className="clinical-data text-sm">
                          {entry.case_date || '-'}
                        </span>
                      </div>
                    </div>

                    {fieldEntries.length > 0 && (
                      <div className="border-t border-border pt-3">
                        <span className="text-xs text-neutral-light/40 block mb-2">
                          Field Values
                        </span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                          {fieldEntries.map(([key, value]) => (
                            <div
                              key={key}
                              className="flex justify-between gap-2"
                            >
                              <span className="text-xs text-neutral-light/40 truncate">
                                {key}
                              </span>
                              <span className="text-xs font-medium truncate">
                                {value === null || value === ''
                                  ? '-'
                                  : String(value)}
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
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
