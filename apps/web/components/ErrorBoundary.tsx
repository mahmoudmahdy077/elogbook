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
        <div role="alert" className="p-8 text-center rounded-xl bg-surface-solid border border-danger/30">
          <h2 className="text-xl font-heading font-semibold text-danger mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={this.reset}
            className="px-5 py-2 rounded-lg border border-primary bg-transparent text-primary cursor-pointer text-sm font-medium transition-colors duration-200 hover:bg-primary hover:text-text-on-primary"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
