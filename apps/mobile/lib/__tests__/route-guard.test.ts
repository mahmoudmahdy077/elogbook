import { describe, it, expect } from 'vitest';
import { guardDeepLink, guardRoute, guardPathname, ROUTE_GUARDS } from '../route-guard';
import type { CapabilitySnapshot } from '../capability';

function cap(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'resident', status: 'active',
    policyVersion: 3, dataMode: 'deidentified', mfaVerifiedAt: Date.now(),
    expiresAt: Date.now() + 3600_000, fetchedAt: Date.now(), ...over,
  };
}

describe('route guards (N1 centralization)', () => {
  it('pins the supported mobile route set', () => {
    expect(Object.keys(ROUTE_GUARDS).sort()).toEqual(
      ['index', 'log-case', 'my-cases', 'case-detail', 'approvals', 'evaluations', 'duty-hours', 'rotations', 'milestones', 'analytics', 'ai-insights', 'profile'].sort(),
    );
  });

  it('allows supported routes with a fresh capable session', () => {
    expect(guardRoute('log-case', cap()).ok).toBe(true);
    expect(guardRoute('approvals', cap({ role: 'supervisor' })).ok).toBe(true);
  });

  it('denies resident access to approvals and everything when suspended', () => {
    expect(guardRoute('approvals', cap()).ok).toBe(false);
    expect(guardRoute('index', cap({ status: 'suspended' })).ok).toBe(false);
    expect(guardRoute('index', null).ok).toBe(false);
  });

  it('refuses admin consoles and unknown deep links', () => {
    expect(guardDeepLink('elogbook://admin', cap()).allowed).toBe(false);
    expect(guardDeepLink('elogbook://billing', cap()).allowed).toBe(false);
    expect(guardDeepLink('elogbook://approvals', cap()).allowed).toBe(false);
    expect(guardDeepLink('elogbook://approvals', cap({ role: 'supervisor' })).allowed).toBe(true);
    expect(guardDeepLink('elogbook://case/abc', cap()).allowed).toBe(true);
    expect(guardDeepLink('https://evil.example/x', cap()).allowed).toBe(false);
  });

  it('denies deep links on stale snapshots for mutating targets', () => {
    const stale = cap({ fetchedAt: Date.now() - 30 * 60_000 });
    expect(guardDeepLink('elogbook://log-case', stale).allowed).toBe(false);
    expect(guardDeepLink('elogbook://dashboard', stale).allowed).toBe(true);
  });

  it('authorizes parsed notification pathnames through the same map', () => {
    expect(guardPathname('/(tabs)/approvals', cap()).ok).toBe(false);
    expect(guardPathname('/(tabs)/approvals', cap({ role: 'supervisor' })).ok).toBe(true);
    expect(guardPathname('/(tabs)/admin', cap()).ok).toBe(false);
    expect(guardPathname('/login', cap()).ok).toBe(false);
  });
});
