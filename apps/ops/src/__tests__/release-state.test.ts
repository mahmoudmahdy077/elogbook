import { describe, it, expect } from 'vitest';
import { resolveReleaseState, type CatalogRelease } from '../release-state';

// T13: GUI states must distinguish up_to_date, update_available,
// unsupported_transition, check_failed, offline, and unknown_current_version.
describe('resolveReleaseState (T13)', () => {
  const catalog: CatalogRelease[] = [
    { version: '1.2.0', source: 'elogbook/v1.2.0', compatibleFrom: ['1.0.0', '1.1.0'], revoked: false },
    { version: '1.1.0', source: 'elogbook/v1.1.0', compatibleFrom: ['1.0.0'], revoked: false },
    { version: '2.0.0', source: 'elogbook/v2.0.0', compatibleFrom: ['1.2.0'], revoked: false },
  ];

  it('unknown_current_version when installed version is absent', () => {
    expect(resolveReleaseState({ currentVersion: '', catalog }).state).toBe('unknown_current_version');
  });

  it('offline vs check_failed are distinct fetch failures', () => {
    expect(resolveReleaseState({ currentVersion: '1.0.0', catalog, fetchError: 'offline' }).state).toBe(
      'offline',
    );
    const failed = resolveReleaseState({ currentVersion: '1.0.0', catalog, fetchError: 'http-500' });
    expect(failed.state).toBe('check_failed');
  });

  it('up_to_date when nothing newer is compatible', () => {
    const res = resolveReleaseState({ currentVersion: '2.0.0', catalog });
    expect(res.state).toBe('up_to_date');
  });

  it('update_available names the newest compatible target', () => {
    const res = resolveReleaseState({ currentVersion: '1.0.0', catalog });
    expect(res.state).toBe('update_available');
    if (res.state === 'update_available') expect(res.target.version).toBe('1.2.0');
  });

  it('unsupported_transition when the only newer release skips the current line', () => {
    const res = resolveReleaseState({ currentVersion: '0.9.0', catalog });
    expect(res.state).toBe('unsupported_transition');
  });

  it('revoked releases are never offered', () => {
    const revoked = catalog.map((r) => (r.version === '1.2.0' ? { ...r, revoked: true } : r));
    const res = resolveReleaseState({ currentVersion: '1.0.0', catalog: revoked });
    expect(res.state).toBe('update_available');
    if (res.state === 'update_available') expect(res.target.version).toBe('1.1.0');
  });

  it('same version is up_to_date, never an update to itself', () => {
    expect(resolveReleaseState({ currentVersion: '2.0.0', catalog }).state).toBe('up_to_date');
  });
});
