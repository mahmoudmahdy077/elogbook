'use client';

import React from 'react';
import * as Sentry from '@sentry/nextjs';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; reset: () => void }>;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // P5.4: Report caught errors to Sentry with component stack trace and route context
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack ?? undefined,
        },
      },
      tags: {
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error} reset={this.reset} />;
      }

      return (
        <div
          role="alert"
          style={{
            padding: '2rem',
            textAlign: 'center',
            borderRadius: '0.75rem',
            background: 'var(--color-neutral-dark, #0F172A)',
            border: '1px solid var(--color-crimson-glow, rgba(239, 68, 68, 0.45))',
          }}
        >
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              fontFamily: 'var(--font-heading)',
              color: '#F87171',
              marginBottom: '0.5rem',
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-neutral-light, #E2E8F0)',
              opacity: 0.7,
              marginBottom: '1.5rem',
            }}
          >
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={this.reset}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-primary, #0D9488)',
              background: 'transparent',
              color: 'var(--color-primary, #0D9488)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              transition: 'background 200ms ease, color 200ms ease',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
