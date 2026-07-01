import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

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

const SENTRY_DSN = (Constants.expoConfig?.extra?.sentryDsn as string | undefined) ?? process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    // P6.3: 10% performance, 100% replay on error
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Disable native crash reporting on Android in dev to avoid noisy
    // dev-build noise; enable via env in production.
    enableNative: process.env.NODE_ENV === 'production',
    beforeSendTransaction(event) {
      return scrubPhi(event);
    },
    beforeSend(event) {
      return scrubPhi(event);
    },
  });
}
