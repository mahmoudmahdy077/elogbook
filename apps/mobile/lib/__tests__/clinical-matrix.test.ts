import { describe, it, expect } from 'vitest';
import { CLINICAL_MATRIX, unsupportedSurfaces, type MatrixRole } from '../clinical-matrix';

const ALL_ROUTES = [
  'login', 'index', 'log-case', 'my-cases', 'case-detail', 'approvals',
  'evaluations', 'duty-hours', 'rotations', 'milestones', 'analytics',
  'ai-insights', 'profile',
];

describe('clinical matrix (M4)', () => {
  it('covers every supported mobile route', () => {
    expect(CLINICAL_MATRIX.map((r) => r.route).sort()).toEqual([...ALL_ROUTES].sort());
  });

  it('gives every route roles, modes, and the mandatory state set', () => {
    for (const row of CLINICAL_MATRIX) {
      expect(row.roles.length, `${row.route}.roles`).toBeGreaterThan(0);
      expect(row.modes.length, `${row.route}.modes`).toBeGreaterThan(0);
      // R5: success/loading/empty/error/offline/queued/retry/denied/expired/
      // suspended/policy-changed/malformed/conflict (+destructive on mutating).
      for (const s of ['loading', 'success', 'empty', 'error', 'offline', 'queued', 'retry', 'denied', 'expired-session', 'suspended-tenant', 'policy-change', 'malformed', 'conflict'] as const) {
        expect(row.states, `${row.route}.states`).toContain(s);
      }
    }
  });

  it('restricts case capture to residents and approvals away from residents', () => {
    const logCase = CLINICAL_MATRIX.find((r) => r.route === 'log-case')!;
    expect(logCase.roles).toEqual(['resident']);
    const approvals = CLINICAL_MATRIX.find((r) => r.route === 'approvals')!;
    expect(approvals.roles).not.toContain('resident');
  });

  it('marks every unsupported surface server-denied with a reason', () => {
    for (const u of unsupportedSurfaces()) {
      expect(u.serverDenied, u.surface).toBe(true);
      expect(u.reason.length, u.surface).toBeGreaterThan(0);
    }
    const surfaces = unsupportedSurfaces().map((u) => u.surface);
    expect(surfaces).toContain('tenant-admin console');
    expect(surfaces).toContain('platform-admin console');
  });

  it('requires destructive-confirm + retry states on mutating routes', () => {
    const mutating = ['log-case', 'evaluations', 'duty-hours', 'approvals'];
    for (const route of mutating) {
      const row = CLINICAL_MATRIX.find((r) => r.route === route)!;
      expect(row.states, route).toContain('retry');
      expect(row.states, route).toContain('destructive-confirm');
    }
    expect(['resident'] satisfies MatrixRole[]);
  });
});
