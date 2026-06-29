import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasHardware: vi.fn(),
  isEnrolled: vi.fn(),
  supportedTypes: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => mocks.hasHardware(),
  isEnrolledAsync: () => mocks.isEnrolled(),
  supportedAuthenticationTypesAsync: () => mocks.supportedTypes(),
  authenticateAsync: (opts: { promptMessage: string }) => mocks.authenticate(opts),
  default: {
    hasHardwareAsync: () => mocks.hasHardware(),
    isEnrolledAsync: () => mocks.isEnrolled(),
    supportedAuthenticationTypesAsync: () => mocks.supportedTypes(),
    authenticateAsync: (opts: { promptMessage: string }) => mocks.authenticate(opts),
  },
}));

import {
  authenticateWithBiometrics,
  BIOMETRIC_CACHE_TTL_MS,
  clearBiometricAuthCache,
  isBiometricAvailable,
  isBiometricSessionValid,
  markBiometricAuthed,
} from '../biometric-gate';

beforeEach(() => {
  mocks.hasHardware.mockReset();
  mocks.isEnrolled.mockReset();
  mocks.supportedTypes.mockReset();
  mocks.authenticate.mockReset();
  clearBiometricAuthCache();
});

describe('isBiometricAvailable', () => {
  it('returns true when hardware + enrollment are both present', async () => {
    mocks.hasHardware.mockResolvedValueOnce(true);
    mocks.isEnrolled.mockResolvedValueOnce(true);
    expect(await isBiometricAvailable()).toBe(true);
  });

  it('returns false when there is no hardware', async () => {
    mocks.hasHardware.mockResolvedValueOnce(false);
    mocks.isEnrolled.mockResolvedValueOnce(true);
    expect(await isBiometricAvailable()).toBe(false);
  });

  it('returns false when hardware exists but no biometric is enrolled', async () => {
    mocks.hasHardware.mockResolvedValueOnce(true);
    mocks.isEnrolled.mockResolvedValueOnce(false);
    expect(await isBiometricAvailable()).toBe(false);
  });
});

describe('authenticateWithBiometrics', () => {
  it('reports unavailable when no hardware / no enrollment', async () => {
    mocks.hasHardware.mockResolvedValueOnce(false);
    mocks.isEnrolled.mockResolvedValueOnce(false);
    const r = await authenticateWithBiometrics('Unlock');
    expect(r.outcome).toBe('unavailable');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('returns authed when the platform prompt succeeds', async () => {
    mocks.hasHardware.mockResolvedValueOnce(true);
    mocks.isEnrolled.mockResolvedValueOnce(true);
    mocks.authenticate.mockResolvedValueOnce({ success: true });
    const r = await authenticateWithBiometrics('Unlock');
    expect(r.outcome).toBe('authed');
    expect(mocks.authenticate).toHaveBeenCalledWith({ promptMessage: 'Unlock' });
  });

  it('returns canceled when the user dismisses the prompt', async () => {
    mocks.hasHardware.mockResolvedValueOnce(true);
    mocks.isEnrolled.mockResolvedValueOnce(true);
    mocks.authenticate.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    const r = await authenticateWithBiometrics('Unlock');
    expect(r.outcome).toBe('canceled');
  });

  it('returns failed for a non-cancel error code', async () => {
    mocks.hasHardware.mockResolvedValueOnce(true);
    mocks.isEnrolled.mockResolvedValueOnce(true);
    mocks.authenticate.mockResolvedValueOnce({ success: false, error: 'lockout' });
    const r = await authenticateWithBiometrics('Unlock');
    expect(r.outcome).toBe('failed');
    expect(r.reason).toBe('lockout');
  });
});

describe('biometric session cache', () => {
  it('is invalid before the user has authenticated', () => {
    expect(isBiometricSessionValid()).toBe(false);
  });

  it('is valid for 5 minutes after a successful auth', () => {
    markBiometricAuthed();
    expect(isBiometricSessionValid()).toBe(true);
  });

  it('expires after the TTL window', () => {
    markBiometricAuthed();
    const pastTtl = Date.now() + BIOMETRIC_CACHE_TTL_MS + 1;
    expect(isBiometricSessionValid(pastTtl)).toBe(false);
  });

  it('clearBiometricAuthCache forces a re-prompt', () => {
    markBiometricAuthed();
    clearBiometricAuthCache();
    expect(isBiometricSessionValid()).toBe(false);
  });
});
