/**
 * Server-owned disposable restore targets.
 *
 * A restore writes an entire backup into a database. The caller must therefore
 * never be able to name that database: a caller-chosen name is one
 * `postgres`/`template1`/production-name typo away from destroying the control
 * plane, and a legitimate-looking name is enough to exfiltrate a dump into a
 * namespace someone else can read.
 *
 * The contract is inverted instead:
 *  - the caller supplies an opaque target id (`restoreTargetId`),
 *  - the database name is DERIVED here inside a private namespace, so no
 *    caller string ever reaches `psql`,
 *  - the id must appear in the operator-provisioned allowlist
 *    (`RESTORE_TARGET_ALLOWLIST`), which is empty by default and therefore
 *    fails closed, and
 *  - reserved PostgreSQL/Supabase/system databases and the live database are
 *    refused even if an operator allowlists them.
 *
 * Provisioning a target stays an operator/setup step (create the database,
 * then name it here); this module only validates and derives.
 */

/** Namespace owned exclusively by restore drills. */
export const RESTORE_TARGET_PREFIX = 'elogbook_restore_';

/**
 * Opaque target ids: lowercase alphanumerics and underscores only. Underscores
 * keep the derived database name inside the 63-byte identifier limit, and the
 * id → name mapping stays injective so two ids can never collide on one
 * database. Callers cannot express `-`, quotes, spaces, or semicolons.
 */
export const RESTORE_TARGET_ID_PATTERN = /^[a-z0-9_][a-z0-9_]{0,31}$/;

/** Databases that must never receive a restore, whatever an operator asks for. */
export const RESERVED_DATABASE_NAMES: ReadonlySet<string> = new Set([
  // PostgreSQL system databases
  'postgres',
  'template0',
  'template1',
  'rdsadmin',
  'defaultdb',
  'cloudsqladmin',
  'azure_maintenance',
  'azure_sys',
  'azure_health',
  'azure_pg_admin',
  'logical',
  // Supabase managed roles/databases
  'supabase',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'supabase_realtime_admin',
  'supabase_functions_admin',
  'supabase_pooler',
  // This installation
  'elogbook',
]);

/** Environment slice the control plane reads; deliberately looser than ProcessEnv. */
export type RestoreEnv = Readonly<Record<string, string | undefined>>;

export type RestoreTargetDenialReason =
  | 'reserved_database'
  | 'invalid_target_id'
  | 'not_provisioned'
  | 'production_database';

export type RestoreTargetResolution =
  | { ok: true; targetId: string; database: string }
  | { ok: false; reason: RestoreTargetDenialReason };

/** True for PostgreSQL/Supabase/system databases and the `pg_` catalog namespace. */
export function isReservedDatabaseName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (RESERVED_DATABASE_NAMES.has(normalized)) return true;
  return normalized.startsWith('pg_') || normalized.startsWith('pg_toast');
}

/**
 * Derive the disposable database name for an opaque target id, or `null` when
 * the id is malformed or names a reserved database.
 */
export function restoreTargetDatabase(targetId: string): string | null {
  if (typeof targetId !== 'string' || !RESTORE_TARGET_ID_PATTERN.test(targetId)) return null;
  if (isReservedDatabaseName(targetId)) return null;
  return `${RESTORE_TARGET_PREFIX}${targetId}`;
}

/**
 * Parse the operator-provisioned allowlist. Malformed and reserved entries are
 * dropped rather than rejected, so one bad entry cannot brick every drill, and
 * so nothing reserved can be smuggled in through configuration.
 */
export function parseRestoreTargetAllowlist(raw: string | undefined | null): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const id = entry.trim();
    if (RESTORE_TARGET_ID_PATTERN.test(id) && !isReservedDatabaseName(id)) seen.add(id);
  }
  return [...seen];
}

export function restoreTargetAllowlistFromEnv(env: RestoreEnv = process.env): string[] {
  return parseRestoreTargetAllowlist(env.RESTORE_TARGET_ALLOWLIST);
}

/**
 * Resolve a caller-supplied target id to the database the server will actually
 * write to, or an explicit denial reason. Fails closed on every ambiguity.
 */
export function resolveRestoreTarget(args: {
  targetId: string;
  allowlist: readonly string[];
  productionDatabase?: string;
}): RestoreTargetResolution {
  const database = restoreTargetDatabase(args.targetId);
  if (database === null) {
    return {
      ok: false,
      reason: typeof args.targetId === 'string' && isReservedDatabaseName(args.targetId)
        ? 'reserved_database'
        : 'invalid_target_id',
    };
  }
  if (!args.allowlist.includes(args.targetId)) {
    return { ok: false, reason: 'not_provisioned' };
  }
  const productionDatabase = (args.productionDatabase ?? '').trim().toLowerCase();
  if (productionDatabase !== '' && database.toLowerCase() === productionDatabase) {
    return { ok: false, reason: 'production_database' };
  }
  return { ok: true, targetId: args.targetId, database };
}
