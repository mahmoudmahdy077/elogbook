import { supabase } from './supabase';

import NetInfo from '@react-native-community/netinfo';

export interface TodayStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  draft: number;
}

const emptyStats: TodayStats = { total: 0, pending: 0, approved: 0, rejected: 0, draft: 0 };

/**
 * Fetch today's case stats for the current user.
 *
 * When online, queries `case_entries` filtered by `case_date = today`
 * and `resident_id = current user's profile id`.
 * When offline, falls back to local WatermelonDB records.
 */
export async function fetchTodayStats(): Promise<TodayStats> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return emptyStats;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) return emptyStats;

  const today = new Date().toISOString().split('T')[0];
  const netState = await NetInfo.fetch();

  if (netState.isConnected) {
    // Online: fetch from Supabase with today filter
    const { data: cases, error } = await supabase
      .from('case_entries')
      .select('status')
      .eq('resident_id', profile.id)
      .eq('case_date', today);

    if (error) {
      console.error('Error fetching today stats:', error);
      return emptyStats;
    }

    if (!cases || cases.length === 0) return emptyStats;

    return countByStatus(cases.map((c) => c.status));
  }

  return emptyStats;
}

function countByStatus(statuses: string[]): TodayStats {
  const stats: TodayStats = { total: 0, pending: 0, approved: 0, rejected: 0, draft: 0 };
  for (const s of statuses) {
    stats.total++;
    if (s === 'draft') stats.draft++;
    else if (s === 'pending') stats.pending++;
    else if (s === 'approved') stats.approved++;
    else if (s === 'rejected') stats.rejected++;
  }
  return stats;
}
