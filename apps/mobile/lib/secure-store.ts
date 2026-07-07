// expo-secure-store wrapper — exposes key-value helpers for storing
// sensitive user preferences (biometric opt-in, session tokens, etc.)
// with a consistent error surface that's trivially mockable in tests.
//
// The module auto-detects whether the native module is linked; on CI / test
// runners it falls back to an in-memory stub so nothing breaks.

import * as SecureStore from 'expo-secure-store';

// ── Keystore keys ─────────────────────────────────────────────────────────────
const BIOMETRIC_ENABLED_KEY = 'biometric_auth_enabled';
const BIOMETRIC_SKIP_WINDOW_KEY = 'biometric_skip_window';

// ── Module probe ──────────────────────────────────────────────────────────────
type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

type SSNamespace = {
  getItemAsync?: (key: string) => Promise<string | null>;
  setItemAsync?: (key: string, value: string) => Promise<void>;
  deleteItemAsync?: (key: string) => Promise<void>;
  default?: SSNamespace;
};

const ss: SecureStoreModule = ((): SecureStoreModule => {
  const ns: SSNamespace =
    (SecureStore as unknown as SSNamespace).default ??
    (SecureStore as unknown as SSNamespace);
  if (typeof ns?.getItemAsync !== 'function') {
    // In-memory fallback for CI / tests
    const mem = new Map<string, string>();
    return {
      getItemAsync: async (k: string) => mem.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => { mem.set(k, v); },
      deleteItemAsync: async (k: string) => { mem.delete(k); },
    };
  }
  return {
    getItemAsync: ns.getItemAsync!.bind(ns),
    setItemAsync: ns.setItemAsync!.bind(ns),
    deleteItemAsync: ns.deleteItemAsync!.bind(ns),
  };
})();

// ── Generic helpers ───────────────────────────────────────────────────────────

export async function getSecureItem(key: string): Promise<string | null> {
  try {
    return await ss.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    await ss.setItemAsync(key, value);
  } catch {
    // silently fail — writes are best-effort
  }
}

export async function removeSecureItem(key: string): Promise<void> {
  try {
    await ss.deleteItemAsync(key);
  } catch {
    // silently fail
  }
}

// ── Biometric preference helpers ──────────────────────────────────────────────

/** Whether the user has opted in to biometric re-auth. */
export async function getBiometricPreference(): Promise<boolean> {
  const raw = await getSecureItem(BIOMETRIC_ENABLED_KEY);
  return raw === 'true';
}

/** Enable / disable biometric re-auth. */
export async function setBiometricPreference(enabled: boolean): Promise<void> {
  if (enabled) {
    await setSecureItem(BIOMETRIC_ENABLED_KEY, 'true');
  } else {
    await removeSecureItem(BIOMETRIC_ENABLED_KEY);
  }
}

/**
 * The number of seconds the app can be backgrounded before biometric re-auth
 * is required. Defaults to 30. Can be persisted per-user.
 */
export async function getBiometricSkipWindow(): Promise<number> {
  const raw = await getSecureItem(BIOMETRIC_SKIP_WINDOW_KEY);
  if (raw === null) return 30; // default
  const n = Number(raw);
  return Number.isFinite(n) ? n : 30;
}

export async function setBiometricSkipWindow(seconds: number): Promise<void> {
  await setSecureItem(BIOMETRIC_SKIP_WINDOW_KEY, String(seconds));
}
