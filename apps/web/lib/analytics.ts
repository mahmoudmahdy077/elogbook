import posthog from 'posthog-js';

export type AnalyticsEvent =
  | 'case_logged'
  | 'case_submitted'
  | 'case_approved'
  | 'case_rejected'
  | 'ai_query'
  | 'subscription_started'
  | 'mfa_enrolled';

const CONSENT_KEY = 'analytics_consent';
const CONSENT_GRANTED = 'granted';
const CONSENT_DENIED = 'denied';
const CONSENT_UNKNOWN = 'unknown';

let initialized = false;
let consentGranted = false;

function readConsentCookie(): 'granted' | 'denied' | 'unknown' {
  if (typeof document === 'undefined') return CONSENT_UNKNOWN;
  const m = document.cookie.match(new RegExp('(?:^|; )' + CONSENT_KEY + '=([^;]*)'));
  const v = m?.[1];
  if (v === CONSENT_GRANTED) return CONSENT_GRANTED;
  if (v === CONSENT_DENIED) return CONSENT_DENIED;
  return CONSENT_UNKNOWN;
}

function writeConsentCookie(value: 'granted' | 'denied') {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${CONSENT_KEY}=${value};path=/;max-age=${maxAge};samesite=lax`;
}

function shouldInit(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!apiKey || !host) return false;
  if (typeof window === 'undefined') return false;
  return true;
}

export function initAnalytics(): void {
  if (initialized) return;
  if (!shouldInit()) return;
  if (readConsentCookie() !== CONSENT_GRANTED) return;

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    // Do not record session replays by default (per privacy plan;
    // error-only mode is handled by Sentry, not PostHog).
    disable_session_recording: true,
  });
  initialized = true;
  consentGranted = true;
}

export function grantConsent(): void {
  writeConsentCookie(CONSENT_GRANTED);
  initAnalytics();
}

export function denyConsent(): void {
  writeConsentCookie(CONSENT_DENIED);
  if (initialized) {
    posthog.opt_out_capturing();
  }
  consentGranted = false;
}

export function hasConsent(): boolean {
  return readConsentCookie() === CONSENT_GRANTED;
}

export function setUserContext(userId: string, tenantId: string): void {
  if (!consentGranted) return;
  posthog.identify(userId, { tenant_id: tenantId });
  posthog.register({ tenant_id: tenantId });
}

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!consentGranted) return;
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function resetUserContext(): void {
  if (initialized) posthog.reset();
}
