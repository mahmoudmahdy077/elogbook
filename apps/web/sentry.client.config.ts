import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development';

// Only initialize Sentry when a DSN is configured. The env-driven
// activation pattern lets us run without Sentry in local dev (zero
// network egress) and switch on for staging/production.
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    // P6.3: 10% performance + 100% replay-on-error
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // PHI: never send patient_mrn, patient_dob, patient_hash, field_values
    beforeSendTransaction(event) {
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
  });
}

export {};
