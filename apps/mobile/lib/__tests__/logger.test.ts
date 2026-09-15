import { describe, it, expect, vi } from 'vitest';
import { logInfo, logWarn, isLogEnabled } from '../logger';

describe('logger M5/P2 (allowlisted, redacted)', () => {
  it('emits structured events with ids', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      logInfo('session.boot', { state: 'ready' });
      expect(debug).toHaveBeenCalled();
      const [msg, extra] = debug.mock.calls[0] as [string, Record<string, unknown>];
      expect(msg).toContain('session.boot');
      expect(extra).toMatchObject({ state: 'ready' });
    } finally {
      debug.mockRestore();
    }
  });

  it('redacts PHI, tokens, URLs, and ciphertext from extras', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      logWarn('sync.flush', {
        patientMrn: 'SECRET-MRN',
        patientDob: '2000-01-01',
        token: 'jwt-secret',
        url: 'https://x.supabase.co/rest?apikey=s3cr3t',
        ciphertext: 'a1b2c3d4e5',
        field_values: { dx: 'x' },
        queueDepth: 3,
      });
      const payload = JSON.stringify(warn.mock.calls[0]);
      expect(payload).not.toContain('SECRET-MRN');
      expect(payload).not.toContain('jwt-secret');
      expect(payload).not.toContain('apikey');
      expect(payload).not.toContain('s3cr3t');
      expect(payload).toContain('queueDepth');
    } finally {
      warn.mockRestore();
    }
  });

  it('is silent in production for info, loud for errors', () => {
    expect(isLogEnabled('info', 'production')).toBe(false);
    expect(isLogEnabled('error', 'production')).toBe(true);
    expect(isLogEnabled('info', 'development')).toBe(true);
  });
});
