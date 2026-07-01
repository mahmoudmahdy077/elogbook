'use client';

import { toUserMessage } from '@/lib/error-messages';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="danger-banner rounded-lg p-4 text-sm space-y-3" role="alert">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="font-medium">{toUserMessage(message)}</p>
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
