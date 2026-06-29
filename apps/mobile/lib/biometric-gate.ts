// expo-local-authentication is a native module; we wrap it so the auth-gate
// flow is testable without a real device and so the rest of the app can
// depend on a single, focused surface.
//
// The shape of this module intentionally mirrors the platform contract:
//   - `isAvailable()` reports whether the device can authenticate.
//   - `authenticate(reason)` returns a promise that resolves to true when
//     the user passes the platform prompt, false on cancel/failure, or
//     throws on hardware error.

type LocalAuthModule = {
  hasHardwareAsync: () => Promise<boolean>;
  isEnrolledAsync: () => Promise<boolean>;
  supportedAuthenticationTypesAsync: () => Promise<number[]>;
  authenticateAsync: (options: { promptMessage: string }) => Promise<{ success: boolean; error?: string }>;
};

type LocalAuthNamespace = {
  hasHardwareAsync?: () => Promise<boolean>;
  isEnrolledAsync?: () => Promise<boolean>;
  supportedAuthenticationTypesAsync?: () => Promise<number[]>;
  authenticateAsync?: (options: { promptMessage: string }) => Promise<{ success: boolean; error?: string }>;
  default?: LocalAuthNamespace;
};

// `import` here is intentional: when the native module is not linked (CI
// or tests), the resolver throws and we fall back to a stub. Vitest's
// `vi.mock` will transparently substitute the real module under test.
import * as LocalAuth from 'expo-local-authentication';

const mod: LocalAuthModule | null = ((): LocalAuthModule | null => {
  const ns: LocalAuthNamespace =
    (LocalAuth as unknown as LocalAuthNamespace).default ?? (LocalAuth as unknown as LocalAuthNamespace);
  if (typeof ns?.hasHardwareAsync !== 'function') return null;
  return {
    hasHardwareAsync: ns.hasHardwareAsync.bind(ns),
    isEnrolledAsync: (ns.isEnrolledAsync ?? (async () => false)).bind(ns),
    supportedAuthenticationTypesAsync: (ns.supportedAuthenticationTypesAsync ?? (async () => [])).bind(ns),
    authenticateAsync: (ns.authenticateAsync ?? (async () => ({ success: false, error: 'unavailable' as const }))).bind(ns),
  };
})();

export type AuthOutcome = 'unavailable' | 'authed' | 'failed' | 'canceled' | 'error';

export type AuthResult = {
  outcome: AuthOutcome;
  reason?: string;
};

export async function isBiometricAvailable(): Promise<boolean> {
  if (!mod) return false;
  try {
    const hw = await mod.hasHardwareAsync();
    const enrolled = await mod.isEnrolledAsync();
    return hw && enrolled;
  } catch {
    return false;
  }
}

export async function authenticateWithBiometrics(prompt: string): Promise<AuthResult> {
  if (!mod) {
    return { outcome: 'unavailable', reason: 'expo-local-authentication is not linked' };
  }
  let hw = false;
  let enrolled = false;
  try {
    hw = await mod.hasHardwareAsync();
    enrolled = await mod.isEnrolledAsync();
  } catch (err) {
    return { outcome: 'error', reason: (err as Error).message };
  }
  if (!hw || !enrolled) {
    return { outcome: 'unavailable' };
  }
  try {
    const res = await mod.authenticateAsync({ promptMessage: prompt });
    if (res.success) return { outcome: 'authed' };
    if (res.error === 'user_cancel' || res.error === 'system_cancel' || res.error === 'app_cancel') {
      return { outcome: 'canceled', reason: res.error };
    }
    return { outcome: 'failed', reason: res.error };
  } catch (err) {
    return { outcome: 'error', reason: (err as Error).message };
  }
}

// In-memory cache so we don't re-prompt on every foreground event. 5 minute
// window matches typical "short re-auth" UX (banking apps).
const CACHE_TTL_MS = 5 * 60 * 1000;
let lastAuthedAt: number | null = null;

export function markBiometricAuthed(): void {
  lastAuthedAt = Date.now();
}

export function clearBiometricAuthCache(): void {
  lastAuthedAt = null;
}

export function isBiometricSessionValid(now: number = Date.now()): boolean {
  if (lastAuthedAt === null) return false;
  return now - lastAuthedAt < CACHE_TTL_MS;
}

export const BIOMETRIC_CACHE_TTL_MS = CACHE_TTL_MS;
