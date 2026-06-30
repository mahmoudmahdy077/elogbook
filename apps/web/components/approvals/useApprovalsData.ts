'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

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

export interface PendingEntry {
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

export interface AllEntry {
  id: string;
  status: string;
}

export function useApprovalsData(tenantId: string) {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [approvalRate, setApprovalRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());

  const fetchPending = useCallback(async () => {
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

    if (pendingRes.error) {
      setError(pendingRes.error.message);
      setLoading(false);
      return;
    }
    if (totalCountRes.error || approvedCountRes.error) {
      setLoading(false);
      return;
    }

    const total = totalCountRes.count ?? 0;
    const approved = approvedCountRes.count ?? 0;
    setApprovalRate(total > 0 ? Math.round((approved / total) * 100) : 0);

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
  }, [supabase, tenantId]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const pendingCount = entries.length;
  const todayUTC = new Date().toISOString().split('T')[0];
  // U4.1: 'Today' should mean 'submitted today' (created_at), not
  // 'procedure dated today' (case_date). Supervisors care about
  // recent activity, not the procedure date which can be older.
  const todayCount = entries.filter(
    (e) => e.created_at?.startsWith(todayUTC)
  ).length;
  const thisWeekCount = entries.filter((e) => {
    const d = new Date(e.created_at).getTime();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return d > weekAgo;
  }).length;

  return {
    entries,
    loading,
    error,
    fetchPending,
    pendingCount,
    todayCount,
    thisWeekCount,
    approvalRate,
  };
}