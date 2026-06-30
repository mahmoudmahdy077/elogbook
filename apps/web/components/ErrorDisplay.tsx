'use client';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

function friendlyMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('duplicate') || lower.includes('unique'))
    return 'This record already exists. Please check for duplicates.';
  if (lower.includes('permission') || lower.includes('violates row-level security'))
    return 'You don\'t have permission to perform this action. Contact your program director if you need access.';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout'))
    return 'A network error occurred. Please check your connection and try again.';
  if (lower.includes('not found') || lower.includes('404'))
    return 'The requested information could not be found. It may have been removed.';
  if (lower.includes('validation') || lower.includes('invalid'))
    return 'Some of the information entered is invalid. Please review and correct your entries.';
  return 'Something went wrong. Please try again. If the problem persists, contact support.';
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="danger-banner rounded-lg p-4 text-sm space-y-3" role="alert">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="font-medium">{friendlyMessage(message)}</p>
          <details className="mt-1.5">
            <summary className="text-xs text-neutral-light/50 cursor-pointer hover:text-neutral-light/60">
              Technical details
            </summary>
            <p className="text-xs text-neutral-light/50 mt-1 font-mono break-all">{message}</p>
          </details>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
