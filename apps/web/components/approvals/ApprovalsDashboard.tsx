'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ApprovalActions from '@/components/ApprovalActions';
import EmptyState from '@/components/EmptyState';
import ErrorDisplay from '@/components/ErrorDisplay';
import { SimpleCounter } from './SimpleCounter';

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

interface AllEntry {
  id: string;
  status: string;
}

const itemVariants = {
  enter: { opacity: 0, y: 16 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -16 },
};

export default function ApprovalsDashboard({ tenantId, tenantSlug }: Props) {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [approvalRate, setApprovalRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchPending = async () => {
    setLoading(true);
    setError(null);

    const [pendingRes, totalCountRes, approvedCountRes] = await Promise.all([
      supabase
        .from('case_entries')
        .select(
          'id, case_date, field_values, is_deidentified, status, resident_id, template_id, tenant_id, created_at, profiles:resident_id(full_name, specialty), case_templates:template_id(specialty, name)'
        )
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('case_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
      supabase
        .from('case_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'approved'),
    ]);

    if (!mountedRef.current) return;

    if (pendingRes.error) {
      setError(pendingRes.error.message);
      setLoading(false);
      return;
    }

    const total = totalCountRes.count ?? 0;
    const approved = approvedCountRes.count ?? 0;
    if (mountedRef.current) setApprovalRate(total > 0 ? Math.round((approved / total) * 100) : 0);

    const entries = (pendingRes.data || []) as Omit<PendingEntry, 'approval_requests'>[];
    const entryIds = entries.map((e) => e.id);

    if (entryIds.length > 0) {
      const { data: approvalData, error: approvalError } = await supabase
        .from('approval_requests')
        .select('id, status, requested_at, comment, entry_id')
        .in('entry_id', entryIds);

      if (approvalError) {
        setError(approvalError.message);
        setLoading(false);
        return;
      }

      interface ApprovalDataRaw {
        id: string;
        status: string;
        requested_at: string;
        comment: string | null;
        entry_id: string;
      }

      const approvalMap = new Map<string, RelationApprovalRequest[]>();
      for (const a of (approvalData || []) as ApprovalDataRaw[]) {
        if (!approvalMap.has(a.entry_id)) approvalMap.set(a.entry_id, []);
        approvalMap.get(a.entry_id)!.push({
          id: a.id,
          status: a.status,
          requested_at: a.requested_at,
          comment: a.comment,
        });
      }

      const merged = entries.map((e) => ({
        ...e,
        approval_requests: approvalMap.get(e.id) || [],
      })) as PendingEntry[];

      setEntries(merged);
    } else {
      setEntries([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchPending();
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
      <div className="panel p-8">
        <ErrorDisplay message={error} onRetry={fetchPending} />
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="panel p-4 text-center">
          <p className="text-2xl font-bold text-amber-400 font-heading">
            <SimpleCounter value={pendingCount} />
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Pending</p>
        </div>
        <div className="panel p-4 text-center">
          <p className="text-2xl font-bold text-teal-400 font-heading">
            <SimpleCounter value={(() => {
              const todayUTC = new Date().toISOString().split('T')[0];
              return entries.filter(e => new Date(e.case_date).toISOString().split('T')[0] === todayUTC).length;
            })()} />
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Today</p>
        </div>
        <div className="panel p-4 text-center">
          <p className="text-2xl font-bold text-indigo-400 font-heading">
            <SimpleCounter value={entries.filter(e => {
              const d = new Date(e.created_at).getTime();
              return d > Date.now() - 7 * 24 * 60 * 60 * 1000;
            }).length} />
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">This Week</p>
        </div>
        <div className="panel p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400 font-heading">
            <SimpleCounter value={approvalRate} />
            <span className="text-lg">%</span>
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Approval Rate</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-5 h-5 text-neutral-light/50" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          }
          title="No pending approvals"
          description="All cases have been reviewed. New submissions will appear here."
        />
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
                              ? 'badge-approved px-2 py-0.5 text-xs font-semibold rounded'
                              : 'badge-pending px-2 py-0.5 text-xs font-semibold rounded'
                          }
                        >
                          {entry.is_deidentified ? 'De-ID' : 'PII'}
                        </span>
                        <span className="badge-pending px-2 py-0.5 text-xs font-semibold rounded">
                          Pending
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-neutral-light/50 block text-xs">
                          Template
                        </span>
                        <span className="font-medium">
                          {template?.specialty}
                          {template?.name ? ` ΓÇô ${template.name}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-light/50 block text-xs">
                          Case Date
                        </span>
                        <span className="clinical-data text-sm">
                          {entry.case_date || '-'}
                        </span>
                      </div>
                    </div>

                    {fieldEntries.length > 0 && (
                      <div className="border-t border-border pt-3">
                        <span className="text-xs text-neutral-light/50 block mb-2">
                          Field Values
                        </span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                          {fieldEntries.map(([key, value]) => (
                            <div
                              key={key}
                              className="flex justify-between gap-2"
                            >
                              <span className="text-xs text-neutral-light/50 truncate">
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
