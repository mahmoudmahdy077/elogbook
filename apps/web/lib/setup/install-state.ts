import { existsSync, lstatSync, readFileSync } from 'fs';
import { isAbsolute, join, normalize, sep } from 'path';
import type { RestoreEnv } from './restore-target';

/**
 * Host installation state read by the control plane (setup/backup/restore/
 * update/uninstall).
 *
 * Two rules hold everywhere below:
 *  1. Locations are overridable (`SETUP_COMPLETE_PATH`, `SUPABASE_CONFIG_PATH`,
 *     `SETUP_STATE_DIR`) so the control plane is testable without a container
 *     and so an installation can point at a non-default data volume.
 *  2. Reading configuration NEVER yields an error string. Callers get `null`
 *     and emit their own generic message — a parse error or a partially
 *     written file must never echo file contents back to an HTTP client.
 */

export type InstallConfig = {
  postgresDb: string;
  postgresPassword: string;
  installPath: string | null;
};

export function installConfigPath(env: RestoreEnv = process.env): string {
  return env.SUPABASE_CONFIG_PATH ?? '/app/data/supabase-config.json';
}

export function setupMarkerPath(env: RestoreEnv = process.env): string {
  return env.SETUP_COMPLETE_PATH ?? '/app/data/.setup-complete';
}

export function controlPlaneStateDir(env: RestoreEnv = process.env): string {
  return env.SETUP_STATE_DIR ?? '/app/data';
}

export function isSetupComplete(env: RestoreEnv = process.env): boolean {
  const marker = setupMarkerPath(env);
  try {
    return existsSync(marker) && lstatSync(marker).isFile();
  } catch {
    return false;
  }
}

/**
 * Read the installer's Supabase config. Returns `null` when the file is
 * missing, unreadable, malformed, or does not carry a complete connection set
 * — the caller must fail closed rather than half-configure a host operation.
 */
export function readInstallConfig(env: RestoreEnv = process.env): InstallConfig | null {
  const path = installConfigPath(env);
  let parsed: unknown;
  try {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) return null;
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const postgresDb = typeof record.postgresDb === 'string' ? record.postgresDb.trim() : '';
  const postgresPassword = typeof record.postgresPassword === 'string' ? record.postgresPassword : '';
  if (postgresDb === '' || postgresPassword === '') return null;
  const installPath = typeof record.installPath === 'string' ? record.installPath : null;
  return { postgresDb, postgresPassword, installPath };
}

/** Directories a destructive control-plane action must never remove. */
const PROTECTED_ROOTS = new Set([
  '/',
  '/app',
  '/apps',
  '/bin',
  '/boot',
  '/data',
  '/dev',
  '/etc',
  '/home',
  '/lib',
  '/lib64',
  '/media',
  '/mnt',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
]);

/**
 * A removal/cwd target is accepted only when it is an absolute, traversal-free
 * POSIX path that is not a protected root. `installPath` comes from a file on
 * disk, but "trusted file" still means an unvalidated string is one bad
 * installer write away from `rm -rf /` or a compose run in `/etc`.
 */
export function isSafeInstallPath(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  const value = candidate.trim();
  if (value === '' || value.length > 512) return false;
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) return false;
  if (!isAbsolute(value)) return false;
  if (value.includes('..')) return false;
  if (value.includes('\\')) return false;
  const normalizedPath = normalize(value);
  if (normalizedPath !== value.replace(/\/+$/, '') && normalizedPath !== value) return false;
  if (PROTECTED_ROOTS.has(normalizedPath)) return false;
  return value !== sep;
}

export function uninstallReceiptPath(scope: string, env: RestoreEnv = process.env): string {
  return join(controlPlaneStateDir(env), 'uninstall-receipts', `${scope}.json`);
}
