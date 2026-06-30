'use client';

import * as Sentry from '@sentry/nextjs';
import type { NextPage } from 'next';

type Props = {
  err?: Error;
  reset?: () => void;
};

const GlobalError: NextPage<Props> = ({ err, reset }) => {
  if (err) Sentry.captureException(err);
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: '#060814', color: '#F1F5F9', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
          <div style={{ maxWidth: '28rem', width: '100%', backgroundColor: '#0F172A', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.15)', padding: '2rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#F1F5F9', fontFamily: 'Outfit, system-ui, sans-serif' }}>Something went wrong</h1>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
              An unexpected error occurred. The error has been reported. Please try refreshing the page.
            </p>
            {err && (
              <pre style={{ fontSize: '0.75rem', color: '#FCA5A5', backgroundColor: 'rgba(220,38,38,0.1)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1.5rem', overflow: 'auto' }}>
                {err.message}
              </pre>
            )}
            <button
              onClick={() => reset?.()}
              style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', backgroundColor: '#0D9488', color: '#FFFFFF', fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
};

export default GlobalError;
