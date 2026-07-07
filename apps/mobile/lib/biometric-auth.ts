// Higher-level biometric auth service.
//
// Builds on the low-level biometric-gate.ts module and adds:
//   - getBiometricType() — discover whether the device has face / fingerprint / iris
//   - authenticateBiometric() — simpler API that accepts an optional message
//   - SecureStore-backed preference integration (check + gate orchestration)
//
// Apple Health design language is applied at the UI layer (BiometricGate.tsx);
// this module stays purely logic.

import {
  isBiometricAvailable as isAvailable,
  authenticateWithBiometrics,
  markBiometricAuthed,
  clearBiometricAuthCache,
  isBiometricSessionValid,
  type AuthResult,
} from './biometric-gate';
import {
  getBiometricPreference,
  getBiometricSkipWindow,
} from './secure-store';

// Re-export the cache primitives so the gate component can use them.
export { markBiometricAuthed, clearBiometricAuthCache, isBiometricSessionValid };
export type { AuthResult };

/** Shape of the full biometric gate check result. */
export type BiometricGateResult =
  | { needsAuth: false }
  | { needsAuth: true; outcome: AuthResult['outcome']; reason?: string };

// ── Biometric type detection ───────────────────────────────────────────────────

/**
 * Returns the type of biometric sensor available on the device.
 *
 * Values correspond to expo-local-authentication's
 * `AuthenticationType` constants:
 *   1  = fingerprint
 *   2  = face
 *   3  = iris
 *
 * Returns `null` when no biometric sensor is available or enrolled.
 */
export async function getBiometricType(): Promise<'face' | 'fingerprint' | 'iris' | null> {
  // Dynamic import so the module is only loaded when needed; the real
  // native module binding happens inside biometric-gate.ts.
  const LocalAuth = await importExpoLocalAuth();
  if (!LocalAuth) return null;

  try {
    const types = await LocalAuth.supportedAuthenticationTypesAsync();
    if (!types || types.length === 0) return null;

    // Prefer the first available type, ordered by common priority.
    const typeMap: Record<number, 'face' | 'fingerprint' | 'iris'> = {
      1: 'fingerprint',
      2: 'face',
      3: 'iris',
    };

    for (const t of types) {
      const mapped = typeMap[t];
      if (mapped) return mapped;
    }
    return null;
  } catch {
    return null;
  }
}

/** Thin typed wrapper around the dynamic import. */
async function importExpoLocalAuth() {
  try {
    const mod = await import('expo-local-authentication');
    const ns = (mod as Record<string, unknown>).default ?? mod;
    return ns as {
      supportedAuthenticationTypesAsync: () => Promise<number[]>;
    } | null;
  } catch {
    return null;
  }
}

// ── Authenticate ──────────────────────────────────────────────────────────────

/**
 * Prompt the user for biometric authentication.
 *
 * @param promptMessage - Optional message shown in the platform dialog.
 * Defaults to a context-appropriate string.
 * @returns `true` if the user successfully authenticated, `false` otherwise.
 */
export async function authenticateBiometric(
  promptMessage?: string,
): Promise<boolean> {
  const msg = promptMessage ?? 'Authenticate to access E-Logbook';
  const result = await authenticateWithBiometrics(msg);
  if (result.outcome === 'authed') {
    markBiometricAuthed();
    return true;
  }
  return false;
}

// ── Orchestration helpers ─────────────────────────────────────────────────────

/**
 * Check whether the biometric gate should be shown right now.
 *
 * Returns `{ needsAuth: false }` when the gate can be skipped (no preference
 * set, biometrics unavailable, or session still valid).
 * Returns `{ needsAuth: true, outcome, reason }` when the user must re-auth.
 */
export async function checkBiometricGate(): Promise<BiometricGateResult> {
  // 1. Is biometric auth enabled in preferences?
  const pref = await getBiometricPreference();
  if (!pref) return { needsAuth: false };

  // 2. Is biometric hardware available and enrolled?
  const available = await isAvailable();
  if (!available) return { needsAuth: false };

  // 3. Is the cached session still valid? (skip re-prompt)
  if (isBiometricSessionValid()) return { needsAuth: false };

  return { needsAuth: true, outcome: 'failed' as const };
}

/**
 * Determine how many seconds to wait before the biometric gate re-triggers
 * after the app goes to the background. Defaults to 30.
 */
export async function getEffectiveSkipWindow(): Promise<number> {
  return getBiometricSkipWindow();
}
