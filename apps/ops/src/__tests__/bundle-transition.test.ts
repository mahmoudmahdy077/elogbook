import { describe, it, expect } from 'vitest';
import { qualifyBundleTransition } from '../bundle-transition';
import type { ReleasePin } from '../release-pin';

// T15 (bounded): bundle-transition qualification. Staged execution and
// restored-clone rehearsal belong to T15-full (BLOCKED: needs VPS).
describe('qualifyBundleTransition (T15)', () => {
  const hex = (c: string) => c.repeat(64);
  const pin = (source: string): ReleasePin => ({
    schemaVersion: 1,
    releaseId: `bundle-${source}`,
    source,
    services: {
      db: `postgres@sha256:${hex('a')}`,
      auth: `supabase/auth@sha256:${hex('b')}`,
    },
  });
  const clean = {
    current: pin('self-hosted/v1.2.0'),
    target: pin('self-hosted/v1.3.0'),
    mergeConflicts: [],
    upstreamBreakingSteps: [],
    acknowledgedBreakingSteps: [],
    rehearsalPassed: true,
    majorPostgresUpgrade: false,
  };

  it('proceeds for a clean qualified transition', () => {
    const res = qualifyBundleTransition(clean);
    expect(res.decision).toBe('proceed');
  });

  it('blocks on merge conflicts without mutating anything', () => {
    const res = qualifyBundleTransition({
      ...clean,
      mergeConflicts: [{ key: 'POSTGRES_PASSWORD', base: 'a', upstream: 'b', operator: 'c' }],
    });
    expect(res.decision).toBe('blocked');
    if (res.decision === 'blocked') expect(res.reasons.join(' ')).toMatch(/conflict/i);
  });

  it('classifies major Postgres upgrades as unsupported-manual', () => {
    const res = qualifyBundleTransition({ ...clean, majorPostgresUpgrade: true });
    expect(res.decision).toBe('unsupported-manual');
    if (res.decision === 'unsupported-manual') {
      expect(res.reasons.join(' ')).toMatch(/postgres/i);
    }
  });

  it('requires acknowledgement + rehearsal for upstream breaking steps', () => {
    const breaking = ['rename auth schema privilege'];
    const unacked = qualifyBundleTransition({ ...clean, upstreamBreakingSteps: breaking });
    expect(unacked.decision).toBe('unsupported-manual');

    const ackedNoRehearsal = qualifyBundleTransition({
      ...clean,
      upstreamBreakingSteps: breaking,
      acknowledgedBreakingSteps: breaking,
      rehearsalPassed: false,
    });
    expect(ackedNoRehearsal.decision).toBe('blocked');

    const acked = qualifyBundleTransition({
      ...clean,
      upstreamBreakingSteps: breaking,
      acknowledgedBreakingSteps: breaking,
      rehearsalPassed: true,
    });
    expect(acked.decision).toBe('proceed');
  });

  it('blocks unpinned/floating target bundles', () => {
    const res = qualifyBundleTransition({
      ...clean,
      target: { ...clean.target, services: { db: 'postgres:15' } },
    });
    expect(res.decision).toBe('blocked');
    if (res.decision === 'blocked') expect(res.reasons.join(' ')).toMatch(/pinn/i);
  });
});
