import { describe, it, expect } from 'vitest';
import { validateReleasePin } from '../release-pin';
import { runPreflight, type PreflightInputs } from '../preflight';
import { mergeEnvConfig } from '../config-merge';

// T11 (bounded): pinned-bundle provisioning primitives. Host execution,
// image pulls, and VPS runs belong to T11-full (BLOCKED: no Docker/VPS).
describe('validateReleasePin (T11)', () => {
  const hex = (c: string) => c.repeat(64);
  const goodPin = {
    schemaVersion: 1,
    releaseId: 'supabase-self-hosted-v1.2.3',
    source: 'self-hosted/v1.2.3',
    services: {
      db: `postgres@sha256:${hex('a')}`,
      auth: `supabase/auth@sha256:${hex('b')}`,
      gateway: `supabase/envoy@sha256:${hex('c')}`,
    },
  };

  it('accepts a fully-pinned bundle', () => {
    expect(validateReleasePin(goodPin).ok).toBe(true);
  });

  it.each([
    ['missing digest', { ...goodPin, services: { ...goodPin.services, db: 'postgres:15' } }],
    ['latest tag', { ...goodPin, services: { ...goodPin.services, auth: 'supabase/auth:latest' } }],
    ['empty services', { ...goodPin, services: {} }],
    ['missing release', { ...goodPin, source: '' }],
  ])('rejects %s (no floating references)', (_label, pin) => {
    const res = validateReleasePin(pin);
    expect(res.ok).toBe(false);
  });
});

describe('runPreflight (T11)', () => {
  const base: PreflightInputs = {
    requiredEnv: { NEXT_PUBLIC_SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'y' },
    freeDiskBytes: 100 * 1024 ** 3,
    requiredDiskBytes: 40 * 1024 ** 3,
    totalRamBytes: 8 * 1024 ** 3,
    requiredRamBytes: 4 * 1024 ** 3,
    cpuCount: 4,
    requiredCpus: 2,
    ports: [
      { port: 80, free: true },
      { port: 443, free: true },
    ],
    registryReachable: true,
  };

  it('passes a qualified host', () => {
    const res = runPreflight(base);
    expect(res.pass).toBe(true);
    expect(res.failures).toEqual([]);
  });

  it('fails honestly on every missing prerequisite (never unknown->pass)', () => {
    const res = runPreflight({
      ...base,
      requiredEnv: { MISSING_KEY: '' },
      freeDiskBytes: 1,
      totalRamBytes: 1,
      cpuCount: 1,
      ports: [{ port: 80, free: false }],
      registryReachable: false,
    });
    expect(res.pass).toBe(false);
    expect(res.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/env/i),
        expect.stringMatching(/disk/i),
        expect.stringMatching(/ram|memory/i),
        expect.stringMatching(/cpu/i),
        expect.stringMatching(/port 80/i),
        expect.stringMatching(/registry/i),
      ]),
    );
  });
});

describe('mergeEnvConfig (T11/T15 staged merge)', () => {
  const base = 'A=1\nB=2\nC=3\n';
  it('fast-forwards clean upstream changes, keeps operator overrides', () => {
    const res = mergeEnvConfig({
      base,
      upstream: 'A=1\nB=22\nC=3\nD=4\n',
      operator: 'A=1\nB=2\nC=33\n',
    });
    // Upstream changed B (operator untouched) -> take upstream; operator
    // changed C (upstream untouched) -> keep operator; D added upstream.
    expect(res.conflicts).toEqual([]);
    expect(res.merged).toContain('B=22');
    expect(res.merged).toContain('C=33');
    expect(res.merged).toContain('D=4');
  });

  it('reports true conflicts instead of guessing', () => {
    const res = mergeEnvConfig({ base, upstream: 'A=1\nB=22\nC=3\n', operator: 'A=1\nB=99\nC=3\n' });
    expect(res.conflicts).toEqual([
      expect.objectContaining({ key: 'B', upstream: '22', operator: '99' }),
    ]);
    // Conflicted key is left at the operator value with a marker comment.
    expect(res.merged).toContain('B=99');
  });

  it('treats upstream deletion vs operator edit as a conflict', () => {
    const res = mergeEnvConfig({ base, upstream: 'A=1\nC=3\n', operator: 'A=1\nB=99\nC=3\n' });
    expect(res.conflicts.map((c) => c.key)).toContain('B');
  });
});
