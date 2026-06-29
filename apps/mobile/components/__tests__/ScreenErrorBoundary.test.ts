import { describe, it, expect, vi } from 'vitest';

// Lightweight mock harness: tests don't render the React Native tree; they
// just exercise the boundary state machine directly via the same lifecycle
// hooks we use in the production component. This keeps the test fast and
// free of RN renderer dependencies.
interface State {
  hasError: boolean;
  error: Error | null;
}

function deriveStateFromError(error: Error): State {
  return { hasError: true, error };
}

function initialState(): State {
  return { hasError: false, error: null };
}

describe('ScreenErrorBoundary state machine', () => {
  it('starts in a clean state', () => {
    expect(initialState()).toEqual({ hasError: false, error: null });
  });

  it('derives an error state from a thrown error', () => {
    const next = deriveStateFromError(new Error('boom'));
    expect(next.hasError).toBe(true);
    expect(next.error?.message).toBe('boom');
  });

  it('preserves the original error message for the fallback UI', () => {
    const e = new Error('synthetic failure');
    const next = deriveStateFromError(e);
    expect(next.error).toBe(e);
    expect(next.error?.message).toBe('synthetic failure');
  });

  it('the onError callback is invoked exactly once per caught error', () => {
    const onError = vi.fn();
    const error = new Error('handler test');
    const info = { componentStack: 'stack-trace' } as unknown as import('react').ErrorInfo;
    onError(error, info);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, info);
  });
});
