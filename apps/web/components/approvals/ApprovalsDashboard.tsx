'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client'
import ApprovalActions from '@/components/ApprovalActions';
import EmptyState from '@/components/EmptyState';
import ErrorDisplay from '@/components/ErrorDisplay';
import { StatusBadge } from '@elogbook/shared/components/web';
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

/* ===== Apple Health Style Stat Card ===== */
function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-4 flex flex-col items-center gap-1.5">
      <p className="text-2xl font-semibold text-text-primary tracking-tight font-sans" style={{ color }}>
        <SimpleCounter value={value} />
        {label === 'Approval Rate' && <span className="text-base">%</span>}
      </p>
      <p className="text-[0.7rem] font-semibold text-text-muted uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default function ApprovalsDashboard({ tenantId, tenantSlug }: Props) {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [approvalRate, setApprovalRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());
  const mountedRef = useRef(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [pendingRes, totalCountRes, approvedCountRes] = await Promise.all([
      supabase
        .from('case_entries')
        .select(
          'id, case_date, is_deidentified, status, resident_id, template_id, tenant_id, created_at, profiles:resident_id(full_name, specialty), case_templates:template_id(specialty, name), approval_requests(id, status, requested_at, comment)'
        )
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50),
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

    setEntries((pendingRes.data || []) as PendingEntry[]);
    setLoading(false);
  }, [tenantId, supabase]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const pendingCount = entries.length;
  const todayUTC = new Date().toISOString().split('T')[0];
  const todayCount = entries.filter(
    (e) => e.created_at?.startsWith(todayUTC)
  ).length;
  const thisWeekCount = entries.filter((e) => {
    const d = new Date(e.created_at).getTime();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return d > weekAgo;
  }).length;

  if (loading) {
    return (
      <div className="bg-surface-solid rounded-2xl border border-border p-8 text-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface-solid rounded-2xl border border-border p-8">
        <ErrorDisplay message={error} onRetry={fetchPending} />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
          Pending Approvals
        </h2>
        {pendingCount > 0 && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-warning-50 text-warning border border-warning/20">
            {pendingCount}
          </span>
        )}
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard value={pendingCount} label="Pending" color="#FF9500" />
        <StatCard value={todayCount} label="Today" color="#007AFF" />
        <StatCard value={thisWeekCount} label="This Week" color="#5856D6" />
        <StatCard value={approvalRate} label="Approval Rate" color="#34C759" />
      </div>

      {/* Pending Entries List */}
      {entries.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-5 h-5 text-text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          }
          title="No pending approvals"
          description="All cases have been reviewed. New submissions will appear here."
        />
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {entries.map((entry) => {
              const profile = entry.profiles[0];
              const template = entry.case_templates[0];
              const approvalRequest = entry.approval_requests[0];
              return (
                <motion.div
                  key={entry.id}
                  variants={itemVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={reduceMotion ? { duration: 0 } : {
                    duration: 0.2,
                    ease: 'easeOut',
                  }}
                >
                  <div className="bg-surface-solid rounded-2xl border border-border p-5 space-y-4">
                    {/* Top row: resident info + badges */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">
                          {profile?.full_name || 'Unknown Resident'}
                        </p>
                        <p className="text-xs text-text-muted">
                          {profile?.specialty || 'No specialty'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={entry.is_deidentified ? 'deidentified' : 'draft'} size="sm">
                          {entry.is_deidentified ? 'De-ID' : 'PII'}
                        </StatusBadge>
                        <StatusBadge status="pending" size="sm" />
                      </div>
                    </div>

                    {/* Template + Case Date */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-text-muted block text-xs">Template</span>
                        <span className="font-medium text-text-primary">
                          {template?.specialty}
                          {template?.name ? ` \u2013 ${template.name}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted block text-xs">Case Date</span>
                        <span className="text-sm font-medium text-text-secondary">
                          {entry.case_date || '-'}
                        </span>
                      </div>
                    </div>

                    {/* Approval Actions */}
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
