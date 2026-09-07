import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const VERSIONS_PATH = '/app/data/versions.json';

export interface ComponentVersion {
  version: string;
  commit: string;
  updated_at: string;
  docker_images: string[];
}

export interface VersionsFile {
  elogbook: ComponentVersion;
  supabase: ComponentVersion;
  migrations: {
    last_run: string;
    count: number;
  };
}

export interface UpdateInfo {
  component: 'elogbook' | 'supabase';
  current_version: string;
  available_version: string;
  current_commit: string;
  available_commit: string;
  changelog?: string;
}

function ensureDir(filePath: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getVersions(versionsPath: string = VERSIONS_PATH): VersionsFile | null {
  if (!existsSync(versionsPath)) return null;
  try {
    const data = readFileSync(versionsPath, 'utf-8');
    return JSON.parse(data) as VersionsFile;
  } catch {
    return null;
  }
}

export function saveVersions(versions: VersionsFile, versionsPath: string = VERSIONS_PATH): void {
  ensureDir(versionsPath);
  writeFileSync(versionsPath, JSON.stringify(versions, null, 2), 'utf-8');
}

export function updateComponentVersion(
  component: 'elogbook' | 'supabase',
  version: string,
  commit: string,
  dockerImages: string[]
): VersionsFile {
  let versions = getVersions();
  if (!versions) {
    versions = {
      elogbook: { version: '', commit: '', updated_at: '', docker_images: [] },
      supabase: { version: '', commit: '', updated_at: '', docker_images: [] },
      migrations: { last_run: '', count: 0 },
    };
  }

  versions[component] = {
    version,
    commit,
    updated_at: new Date().toISOString(),
    docker_images: dockerImages,
  };

  saveVersions(versions);
  return versions;
}

export type UpdateCheckState =
  | 'update-available'
  | 'up-to-date'
  | 'check-failed'
  | 'offline'
  | 'unknown-current-version'
  | 'unsupported-source';

export interface UpdateCheckResult {
  state: UpdateCheckState;
  component: 'elogbook' | 'supabase';
  current_version?: string;
  available_version?: string;
  current_commit?: string;
  available_commit?: string;
  changelog?: string;
  /** Machine-readable reason for non-available states (safe to display). */
  reason?: string;
}

/**
 * T13/F06: every outcome is explicit. A failed lookup previously returned
 * null, which the UI rendered as "up to date". The release repository is
 * explicit configuration (ELOGBOOK_RELEASE_REPO=owner/repo); the old
 * `{owner}` placeholder could never have worked. Supabase monorepo
 * `latest` is not a qualified self-hosted bundle update (T15 owns bundle
 * updates), so that component reports unsupported-source by design.
 */
export async function checkForUpdates(
  component: 'elogbook' | 'supabase',
  opts: { versionsPath?: string; releaseRepo?: string; fetchFn?: typeof fetch } = {}
): Promise<UpdateCheckResult> {
  const versions = getVersions(opts.versionsPath);
  const current = versions?.[component];
  if (!current?.version) {
    return { state: 'unknown-current-version', component, reason: 'no recorded installed version' };
  }

  if (component === 'supabase') {
    return {
      state: 'unsupported-source',
      component,
      current_version: current.version,
      reason: 'Supabase updates ship as qualified bundles (see release catalog); monorepo latest is not one',
    };
  }

  const repo = opts.releaseRepo ?? process.env.ELOGBOOK_RELEASE_REPO;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return {
      state: 'check-failed',
      component,
      current_version: current.version,
      reason: 'release repository not configured (ELOGBOOK_RELEASE_REPO=owner/repo)',
    };
  }

  const runFetch = opts.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await runFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    if (e instanceof TypeError) {
      return { state: 'offline', component, current_version: current.version, reason: 'network unreachable' };
    }
    return {
      state: 'check-failed',
      component,
      current_version: current.version,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  if (!response.ok) {
    return {
      state: 'check-failed',
      component,
      current_version: current.version,
      reason: `release provider returned ${response.status}`,
    };
  }

  const release = (await response.json()) as { tag_name: string; target_commitish: string; body?: string };
  if (!release.tag_name || release.tag_name === current.version) {
    return { state: 'up-to-date', component, current_version: current.version };
  }

  return {
    state: 'update-available',
    component,
    current_version: current.version,
    available_version: release.tag_name,
    current_commit: current.commit,
    available_commit: release.target_commitish,
    changelog: release.body || '',
  };
}
