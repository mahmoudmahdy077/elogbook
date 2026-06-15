import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

interface NotificationResult {
  newApprovals: number;
  newRejections: Array<{ comment: string | null; entryId: string }>;
}

export function useCaseNotifications(
  residentId: string,
  onRejection?: (entryId: string, comment: string | null) => void
) {
  const badgeCount = useRef(0);
  const lastCheck = useRef<number>(0);

  useEffect(() => {
    async function check() {
      try {
        const stored = await AsyncStorage.getItem('last_notification_check');
        const since = stored ? parseInt(stored, 10) : 0;

        const { data } = await supabase
          .from('approval_requests')
          .select('id, entry_id, status, comment, resolved_at, case_entries!inner(resident_id)')
          .eq('case_entries.resident_id', residentId)
          .not('resolved_at', 'is', null)
          .gt('resolved_at', new Date(since).toISOString());

        if (!data) return;

        const newApprovals = data.filter((r: any) => r.status === 'approved').length;
        const newRejections = data
          .filter((r: any) => r.status === 'rejected')
          .map((r: any) => ({ comment: r.comment, entryId: r.entry_id }));

        if (newRejections.length > 0 && onRejection) {
          onRejection(newRejections[0].entryId, newRejections[0].comment);
        }

        badgeCount.current = newApprovals + newRejections.length;
        await AsyncStorage.setItem('last_notification_check', Date.now().toString());
        lastCheck.current = Date.now();
      } catch {
        // silently ignore polling errors
      }
    }

    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [residentId, onRejection]);

  return { badgeCount };
}
