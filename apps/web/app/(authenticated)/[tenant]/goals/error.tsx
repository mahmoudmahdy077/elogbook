'use client';

export default function GoalsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="glass-panel p-6 text-center">
          <h2 className="text-xl font-semibold text-danger mb-2">Unable to load goals</h2>
          <p className="text-sm text-surface-secondary mb-4">{error.message}</p>
          <button
            onClick={reset}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
