/**
 * Release-state resolution (T13).
 *
 * The GUI must distinguish six states; a failed lookup must never read as
 * "up to date", and an incompatible jump must never read as a routine
 * update. Pure over (installed version, signed-catalog view); signature
 * verification of the catalog itself is T13-full.
 */

export type ReleaseCheckState =
  | 'up_to_date'
  | 'update_available'
  | 'unsupported_transition'
  | 'check_failed'
  | 'offline'
  | 'unknown_current_version';

export interface CatalogRelease {
  version: string;
  source: string;
  /** Installed versions this release can update from directly. */
  compatibleFrom: string[];
  revoked: boolean;
}

export type ReleaseResolution =
  | { state: 'up_to_date' }
  | { state: 'update_available'; target: CatalogRelease }
  | { state: 'unsupported_transition'; newest: CatalogRelease }
  | { state: 'check_failed'; reason: string }
  | { state: 'offline' }
  | { state: 'unknown_current_version' };

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((p) => parseInt(p, 10));
  const pb = b.replace(/^v/, '').split('.').map((p) => parseInt(p, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const db = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function resolveReleaseState(args: {
  currentVersion: string;
  catalog: CatalogRelease[];
  fetchError?: string;
}): ReleaseResolution {
  if (!args.currentVersion) return { state: 'unknown_current_version' };
  if (args.fetchError === 'offline') return { state: 'offline' };
  if (args.fetchError) return { state: 'check_failed', reason: args.fetchError };

  const live = args.catalog.filter((r) => !r.revoked);
  const newer = live
    .filter((r) => compareVersions(args.currentVersion, r.version) < 0)
    .sort((x, y) => compareVersions(x.version, y.version));
  if (newer.length === 0) return { state: 'up_to_date' };

  const compatible = newer.filter((r) => r.compatibleFrom.includes(args.currentVersion));
  if (compatible.length > 0) {
    return { state: 'update_available', target: compatible[compatible.length - 1] };
  }
  return { state: 'unsupported_transition', newest: newer[newer.length - 1] };
}
