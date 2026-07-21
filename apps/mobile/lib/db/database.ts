// UXM-001 / SEC-006 / SEC-007: offline PHI storage is disabled in v1.
// SQLCipher device-level encryption and sync idempotency have not been
// verified on physical devices. Re-enable in v2 after the blockers are
// fixed and device-tested.

export class OfflineStorageDisabledError extends Error {
  constructor() {
    super(
      'Offline storage is disabled in this build. ' +
      'Use supabase.ts directly for all reads and writes. ' +
      'See docs/ANALYSIS_AND_UPGRADE_PLAN.md §UXM-001.'
    );
    this.name = 'OfflineStorageDisabledError';
  }
}

export async function initDatabase(): Promise<never> {
  throw new OfflineStorageDisabledError();
}

export function getDatabase(): never {
  throw new OfflineStorageDisabledError();
}
