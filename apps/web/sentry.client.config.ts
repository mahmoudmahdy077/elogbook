import * as Sentry from '@sentry/nextjs';

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

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development';

// Only initialize Sentry when a DSN is configured. The env-driven
// activation pattern lets us run without Sentry in local dev (zero
// network egress) and switch on for staging/production.
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    // P5.4: 20% performance tracing + 10% session replay sampling
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? '0.1'),
    replaysOnErrorSampleRate: 1.0,
    // P5.4: Auto-instrument page loads, navigation, and client-side interactions
    integrations: [Sentry.browserTracingIntegration()],
    // PHI: never send patient_mrn, patient_dob, patient_hash, field_values
    beforeSendTransaction(event) {
      if (event.request?.cookies) delete event.request.cookies;
      return scrubPhi(event, ['patient_mrn', 'patient_dob', 'patient_hash', 'field_values']);
    },
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      return scrubPhi(event, ['patient_mrn', 'patient_dob', 'patient_hash', 'field_values']);
    },
  });
}

export {};
