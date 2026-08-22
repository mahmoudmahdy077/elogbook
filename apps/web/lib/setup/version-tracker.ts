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

export function getVersions(): VersionsFile | null {
  if (!existsSync(VERSIONS_PATH)) return null;
  try {
    const data = readFileSync(VERSIONS_PATH, 'utf-8');
    return JSON.parse(data) as VersionsFile;
  } catch {
    return null;
  }
}

export function saveVersions(versions: VersionsFile): void {
  ensureDir(VERSIONS_PATH);
  writeFileSync(VERSIONS_PATH, JSON.stringify(versions, null, 2), 'utf-8');
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

export async function checkForUpdates(component: 'elogbook' | 'supabase'): Promise<UpdateInfo | null> {
  const versions = getVersions();
  if (!versions) return null;

  const current = versions[component];

  try {
    let apiUrl: string;
    if (component === 'elogbook') {
      apiUrl = 'https://api.github.com/repos/{owner}/elogbook/releases/latest';
    } else {
      apiUrl = 'https://api.github.com/repos/supabase/supabase/releases/latest';
    }

    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const release = await response.json() as { tag_name: string; target_commitish: string; body?: string };

    return {
      component,
      current_version: current.version,
      available_version: release.tag_name,
      current_commit: current.commit,
      available_commit: release.target_commitish,
      changelog: release.body || '',
    };
  } catch {
    return null;
  }
}
