'use client';

import * as Sentry from '@sentry/nextjs';
import type { NextPage } from 'next';

type Props = {
  // Next.js passes `error` and `reset` to a global-error boundary. The old
  // signature destructured `err`, which Next never sends, so the error was
  // never captured and the reference block never rendered.
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Last-resort boundary. It cannot rely on the app stylesheet, so the design
 * tokens are inlined here. Keep them in sync with app/globals.css: light
 * backdrop, white surface, border-defined elevation, Apple blue primary.
 */
const tokens = {
  backdrop: '#F2F2F7',
  surface: '#FFFFFF',
  border: 'rgba(60, 60, 67, 0.10)',
  text: '#000000',
  textSecondary: '#3C3C43',
  textMuted: '#6D6D73',
  primary: '#007AFF',
  danger: '#C20012',
  dangerTint: 'rgba(194, 0, 18, 0.08)',
};

const GlobalError: NextPage<Props> = ({ error, reset }) => {
  Sentry.captureException(error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: tokens.backdrop,
          color: tokens.text,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        }}
      >
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
          <div
            style={{
              maxWidth: '28rem',
              width: '100%',
              backgroundColor: tokens.surface,
              borderRadius: '14px',
              border: `1px solid ${tokens.border}`,
              padding: '2rem',
            }}
          >
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.025em', marginBottom: '0.75rem', color: tokens.text }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '0.875rem', color: tokens.textSecondary, marginBottom: '1.5rem', lineHeight: 1.5 }}>
              An unexpected error occurred and has been reported. Try again, or reload the page if it keeps happening.
            </p>
            {error && (
              <p
                role="alert"
                style={{
                  fontSize: '0.8125rem',
                  color: tokens.danger,
                  backgroundColor: tokens.dangerTint,
                  border: '1px solid rgba(194, 0, 18, 0.18)',
                  borderRadius: '10px',
                  padding: '0.75rem',
                  marginBottom: '1.5rem',
                }}
              >
                Error reference: {error.digest ?? 'not available'}. Quote this when you contact support.
              </p>
            )}
            <button
              onClick={() => reset?.()}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0.625rem',
                borderRadius: '10px',
                backgroundColor: tokens.primary,
                color: '#FFFFFF',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <p style={{ fontSize: '0.75rem', color: tokens.textMuted, marginTop: '1rem', textAlign: 'center' }}>
              If this continues, contact your program administrator.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
};

export default GlobalError;
