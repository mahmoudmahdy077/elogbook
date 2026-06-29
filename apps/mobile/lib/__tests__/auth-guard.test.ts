import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockUnsubscribe = vi.fn();
let capturedAuthCallback: ((event: string, session: unknown) => void) | null = null;

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        capturedAuthCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));

import { subscribeToAuth } from '../auth-guard';

beforeEach(() => {
  mockGetSession.mockReset();
  mockUnsubscribe.mockReset();
  capturedAuthCallback = null;
});

describe('subscribeToAuth', () => {
  it('reports isAuthenticated=false when no session exists', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    const states: Array<{ isAuthenticated: boolean; isLoading: boolean }> = [];
    const unsubscribe = subscribeToAuth(undefined as never, (s) => states.push(s));

    await new Promise((r) => setTimeout(r, 0));

    expect(states[states.length - 1]).toEqual({ isAuthenticated: false, isLoading: false });
    expect(typeof unsubscribe).toBe('function');
  });

  it('reports isAuthenticated=true when session is present', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });

    const states: Array<{ isAuthenticated: boolean; isLoading: boolean }> = [];
    subscribeToAuth(undefined as never, (s) => states.push(s));

    await new Promise((r) => setTimeout(r, 0));

    expect(states[states.length - 1]).toEqual({ isAuthenticated: true, isLoading: false });
  });

  it('updates on auth change events (sign in)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    const states: Array<{ isAuthenticated: boolean; isLoading: boolean }> = [];
    subscribeToAuth(undefined as never, (s) => states.push(s));

    await new Promise((r) => setTimeout(r, 0));
    expect(states[states.length - 1]?.isAuthenticated).toBe(false);

    capturedAuthCallback!('SIGNED_IN', { access_token: 'jwt' });

    expect(states[states.length - 1]).toEqual({ isAuthenticated: true, isLoading: false });
  });

  it('updates on auth change events (sign out)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'jwt' } } });

    const states: Array<{ isAuthenticated: boolean; isLoading: boolean }> = [];
    subscribeToAuth(undefined as never, (s) => states.push(s));

    await new Promise((r) => setTimeout(r, 0));
    expect(states[states.length - 1]?.isAuthenticated).toBe(true);

    capturedAuthCallback!('SIGNED_OUT', null);

    expect(states[states.length - 1]).toEqual({ isAuthenticated: false, isLoading: false });
  });

  it('treats session fetch errors as unauthenticated', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('network'));

    const states: Array<{ isAuthenticated: boolean; isLoading: boolean }> = [];
    subscribeToAuth(undefined as never, (s) => states.push(s));

    await new Promise((r) => setTimeout(r, 0));

    expect(states[states.length - 1]).toEqual({ isAuthenticated: false, isLoading: false });
  });

  it('unsubscribe tears down subscription', () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const unsubscribe = subscribeToAuth();
    unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
