// P5.17 decision (documented): we removed the `expo-notifications` plugin
// from app.json rather than wiring real push notifications. Rationale:
//   1. Real push requires (a) the server to maintain a push_tokens table
//      keyed on user_id + device_id, (b) an `notify_resident` RPC that
//      the approval flow invokes, and (c) a server-side APNS/FCM credential
//      configured per-tenant. The full plumbing is too large for the
//      mobile-app phase and is better owned by the Supabase layer in
//      Phase 2 / Phase 6.
//   2. The polling loop here still surfaces rejections within 60s, which
//      is acceptable for the supervisor-review workflow. When push lands,
//      the next migration (P5.17+) will add `expo-notifications` back,
//      add a `push_tokens` migration, and replace the polling interval
//      with the platform push handler.
//
// Until then, this file stays as the polling implementation that the
// MyCases / Approvals screens rely on.

import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

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

        const newApprovals = data.filter((r: { status: string }) => r.status === 'approved').length;
        const newRejections = data
          .filter((r: { status: string }) => r.status === 'rejected')
          .map((r: { comment: string | null; entry_id: string }) => ({ comment: r.comment, entryId: r.entry_id }));

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
