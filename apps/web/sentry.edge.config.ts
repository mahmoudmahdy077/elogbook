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

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.SENTRY_ENV ?? (process.env.NODE_ENV ?? 'development');

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    // P5.4: 10% edge-level performance tracing (lower volume due to high frequency)
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
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
