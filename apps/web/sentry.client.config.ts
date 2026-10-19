import * as Sentry from '@sentry/nextjs';
import { redactSentryEvent } from './lib/observability/redact';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    denyUrls: [
      /\/api\/auth\//i,
      /\/admin\//i,
      /\/login/i,
      /\/auth\/callback/i,
    ],
    integrations: [Sentry.browserTracingIntegration()],
    beforeSendTransaction(event) {
      return redactSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return redactSentryEvent(breadcrumb);
    },
    beforeSend(event) {
      return redactSentryEvent(event);
    },
  });
}

export {};
