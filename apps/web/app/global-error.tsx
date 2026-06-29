'use client';

import * as Sentry from '@sentry/nextjs';
import type { NextPage } from 'next';
import ErrorBoundary from '@/components/ErrorBoundary';

type Props = {
  err?: Error;
  reset?: () => void;
};

const GlobalError: NextPage<Props> = ({ err, reset }) => {
  // Sentry's nextjs helper renders the standard error page in production
  // and surfaces the error in dev. Calling captureException is the
  // recommended pattern for custom error.tsx files.
  if (err) Sentry.captureException(err);
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <div style={{ padding: 24 }}>
            <h1>Something went wrong</h1>
            <button onClick={() => reset?.()}>Try again</button>
          </div>
        </ErrorBoundary>
      </body>
    </html>
  );
};

export default GlobalError;
