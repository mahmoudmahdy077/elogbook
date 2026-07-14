import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.EXPO_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development';

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
    environment: SENTRY_ENV,
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    // PHI: never send patient fields
    beforeSend(event) {
      return scrubPhi(event as typeof event);
    },
    beforeBreadcrumb(breadcrumb) {
      // Redact navigation breadcrumbs that contain patient data
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

const SentryNavigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

export { Sentry, SentryNavigationIntegration };
export default Sentry;
