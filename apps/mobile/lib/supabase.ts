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
        ? (() => {
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

function createRealClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
    global: {
      fetch: createFetchWithTimeout(),
    },
  });
}

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your environment.'
    );
  }

  _client = createRealClient();
  return _client;
}

/** Convenience re-export for direct use */
export const supabase = getSupabaseClient();
