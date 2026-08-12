// Push notification registration + foreground presentation for the
// approval lifecycle. Uses the push_tokens table (Task 6.1).
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export { notificationPayloadToBadgeIncrement } from './notification-payload';

export interface PushRegistration {
  ok: boolean;
  error: string | null;
}

export async function configureForegroundNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function registerPushToken(): Promise<PushRegistration> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return { ok: false, error: 'permission denied' };

    const projectId = Constants.easConfig?.projectId;
    if (!projectId) return { ok: false, error: 'missing EAS project id' };

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'no session' };

    const tenantId = (user.app_metadata?.tenant_id as string) ?? null;
    if (!tenantId) return { ok: false, error: 'no tenant' };

    const { error } = await supabase.from('push_tokens').upsert(
      {
        tenant_id: tenantId,
        user_id: user.id,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // non-fatal
  }
}
