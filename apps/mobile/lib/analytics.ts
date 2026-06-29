import PostHog from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AnalyticsEvent =
  | 'case_logged'
  | 'case_submitted'
  | 'case_approved'
  | 'case_rejected'
  | 'ai_query'
  | 'subscription_started'
  | 'mfa_enrolled';

const CONSENT_KEY = 'analytics_consent';
const POSTHOG_INSTANCE_KEY = 'posthog_singleton';

let posthog: PostHog | null = null;

export async function initAnalytics(): Promise<void> {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;
  if (!apiKey || !host) return;

  const consent = await AsyncStorage.getItem(CONSENT_KEY);
  if (consent !== 'granted') return;

  posthog = new PostHog(apiKey, { host });
  // Stash on global so HMR + tests can introspect if needed
  (globalThis as Record<string, unknown>)[POSTHOG_INSTANCE_KEY] = posthog;
}

export async function grantConsent(): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, 'granted');
  await initAnalytics();
}

export async function denyConsent(): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, 'denied');
  if (posthog) posthog.optOut();
}

export async function hasConsent(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CONSENT_KEY);
  return v === 'granted';
}

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, string | number | boolean | null>): void {
  if (!posthog) return;
  posthog.capture(event, properties);
}

export function setUserContext(userId: string, tenantId: string): void {
  if (!posthog) return;
  posthog.identify(userId, { tenant_id: tenantId });
  posthog.register({ tenant_id: tenantId });
}

export function resetUserContext(): void {
  if (posthog) posthog.reset();
}
