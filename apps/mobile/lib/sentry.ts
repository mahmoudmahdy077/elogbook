// Sentry error tracking — gracefully degrades when no DSN is set
// Import this module to make Sentry.captureException available everywhere.

import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// PHI-sensitive fields to scrub from Sentry events
const PHI_FIELDS = ['patient_mrn', 'patient_dob', 'patient_hash', 'field_values'];

function scrubPhi<T>(event: T, fields: string[] = PHI_FIELDS): T {
  if (!event || typeof event !== 'object') return event;
  for (const key of Object.keys(event as Record<string, unknown>)) {
    if (fields.includes(key)) {
      delete (event as Record<string, unknown>)[key];
    } else {
      const val = (event as Record<string, unknown>)[key];
      if (typeof val === 'object' && val !== null) {
        scrubPhi(val, fields);
      }
    }
  }
  return event;
}

// Only initialize Sentry when a DSN is configured
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    beforeSend(event) {
      return scrubPhi(event as typeof event);
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url && typeof breadcrumb.data.url === 'string') {
        const url = breadcrumb.data.url as string;
        if (url.includes('/patient/') || url.includes('/case/')) {
          breadcrumb.data.url = url.replace(/\/[^/]+$/, '/[redacted]');
        }
      }
      return breadcrumb;
    },
  });
}

export { Sentry };
export default Sentry;
