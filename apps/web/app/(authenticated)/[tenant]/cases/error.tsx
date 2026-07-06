'use client';

/**
 * P1.10: Cases route error boundary.
 * Apple Health design: white bg, blue accent, clear error message, retry button.
 */
export default function CasesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-center min-h-[40vh]"
    >
      <div
        className="w-full max-w-md mx-auto rounded-2xl border border-[--color-border]"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(20px)', padding: '2rem', textAlign: 'center' }}
      >
        <div
          className="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full"
          style={{ backgroundColor: 'rgba(255, 59, 48, 0.10)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2
          className="text-lg font-semibold mb-1"
          style={{ color: '#000000', fontFamily: 'var(--font-heading)' }}
        >
          Unable to load cases
        </h2>
        <p
          className="text-sm mb-6"
          style={{ color: '#8E8E93' }}
        >
          We encountered an error while loading your cases. Please try again.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200"
          style={{
            backgroundColor: '#007AFF',
            color: '#FFFFFF',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#0066D6')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#007AFF')}
        >
          Try again
        </button>
        {error.digest && (
          <p
            className="mt-4 text-xs"
            style={{ color: '#AEAEB2' }}
          >
            Error reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
