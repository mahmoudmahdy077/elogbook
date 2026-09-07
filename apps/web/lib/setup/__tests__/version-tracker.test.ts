import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkForUpdates } from '../version-tracker';

// T13/F06: a failed update check must never read as "up to date", the
// release source must be explicit (no {owner} placeholder), and the
// monorepo-latest Supabase check must not pose as a qualified update.
describe('checkForUpdates states (T13)', () => {
  let dir = '';
  let versionsPath = '';
  const OLD_REPO = process.env.ELOGBOOK_RELEASE_REPO;

  const seed = (version: string) => {
    writeFileSync(
      versionsPath,
      JSON.stringify({
        elogbook: { version, commit: 'abc', updated_at: '', docker_images: [] },
        supabase: { version: 'v1', commit: '', updated_at: '', docker_images: [] },
        migrations: { last_run: '', count: 0 },
      }),
    );
  };
  const fetchOk = (tag: string) =>
    (async () =>
      new Response(JSON.stringify({ tag_name: tag, target_commitish: 'def', body: '' }), {
        status: 200,
      })) as unknown as typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'versions-test-'));
    versionsPath = join(dir, 'versions.json');
    process.env.ELOGBOOK_RELEASE_REPO = 'acme/elogbook';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (OLD_REPO === undefined) delete process.env.ELOGBOOK_RELEASE_REPO;
    else process.env.ELOGBOOK_RELEASE_REPO = OLD_REPO;
  });

  it('unknown-current-version when no versions file exists', async () => {
    const res = await checkForUpdates('elogbook', { versionsPath, fetchFn: fetchOk('v9') });
    expect(res.state).toBe('unknown-current-version');
  });

  it('up-to-date when the tag equals the installed version (never self-update)', async () => {
    seed('v1.2.0');
    const res = await checkForUpdates('elogbook', { versionsPath, fetchFn: fetchOk('v1.2.0') });
    expect(res.state).toBe('up-to-date');
  });

  it('update-available names current and target', async () => {
    seed('v1.1.0');
    const res = await checkForUpdates('elogbook', { versionsPath, fetchFn: fetchOk('v1.2.0') });
    expect(res.state).toBe('update-available');
    if (res.state === 'update-available') {
      expect(res.current_version).toBe('v1.1.0');
      expect(res.available_version).toBe('v1.2.0');
    }
  });

  it('check-failed on provider errors and unconfigured repository', async () => {
    seed('v1.1.0');
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect((await checkForUpdates('elogbook', { versionsPath, fetchFn: failing })).state).toBe(
      'check-failed',
    );
    delete process.env.ELOGBOOK_RELEASE_REPO;
    expect((await checkForUpdates('elogbook', { versionsPath, fetchFn: fetchOk('v9') })).state).toBe(
      'check-failed',
    );
  });

  it('offline on network failure (distinct from check-failed)', async () => {
    seed('v1.1.0');
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await checkForUpdates('elogbook', { versionsPath, fetchFn: down })).state).toBe('offline');
  });

  it('supabase component is unsupported-source (monorepo latest is not a qualified bundle)', async () => {
    seed('v1.1.0');
    const res = await checkForUpdates('supabase', { versionsPath, fetchFn: fetchOk('v99') });
    expect(res.state).toBe('unsupported-source');
  });
});
