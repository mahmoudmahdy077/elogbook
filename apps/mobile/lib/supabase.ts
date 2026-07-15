/**
 * Supabase client configured for React Native with Expo SecureStore.
 *
 * Keystone for all remote data operations. Configured with:
 * - SecureStore for auth token persistence (encrypted at rest)
 * - Auto-refresh for JWT tokens
 * - Custom fetch with timeout to prevent hanging requests
 * - Graceful degradation when config is missing
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Fallback: no-op client when Supabase is not configured
// ---------------------------------------------------------------------------

function createNoopClient(): SupabaseClient {
  // Recursive proxy that returns functions with meaningful errors for any
  // leaf property, but returns child proxies for intermediate objects.
  // This allows nested access like noop.auth.signOut() to produce a
  // helpful error message instead of "undefined is not a function".
  function createProxy(path: string[]): Record<string, unknown> {
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        const key = String(prop);
        const fullPath = [...path, key];
        // For 'then' just return undefined (not a thenable)
        if (key === 'then') return undefined;
        // Return a function that rejects with a descriptive error
        return (...args: unknown[]) =>
          Promise.reject(
            new Error(
              `Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY. Called: ${fullPath.join('.')}(${args.length} args)`
            )
          );
      },
    });
  }
  return createProxy([]) as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// SecureStore adapter for auth persistence (encrypted at rest)
// ---------------------------------------------------------------------------

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// ---------------------------------------------------------------------------
// Fetch with timeout (prevents hanging requests)
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000;

function createFetchWithTimeout(
  baseFetch: typeof fetch = fetch
): typeof fetch {
  return (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    return baseFetch(url, {
      ...options,
      signal: options?.signal
        ? // Combine external+internal abort signals
          (() => {
            const externalSignal = options.signal;
            const combinedController = new AbortController();
            const onAbort = () => combinedController.abort();
            externalSignal.addEventListener('abort', onAbort);
            controller.signal.addEventListener('abort', onAbort);
            return combinedController.signal;
          })()
        : controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[Supabase] Missing configuration — using no-op client. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
    );
    _client = createNoopClient();
    return _client;
  }

  _client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      detectSessionInUrl: false, // Mobile — no URL-based sessions
      persistSession: true,
    },
    global: {
      fetch: createFetchWithTimeout(),
    },
  });

  return _client;
}

/** Convenience re-export for direct use */
export const supabase = getSupabaseClient();
