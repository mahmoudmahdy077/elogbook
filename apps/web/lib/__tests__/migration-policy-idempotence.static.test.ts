import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration-order guard for RLS policy creation.
 *
 * `CREATE POLICY` has no `OR REPLACE` and no `IF NOT EXISTS`: naming a policy
 * that already exists raises duplicate_object, which aborts the transaction and
 * therefore the whole migration. 20260927000002 dropped only the obsolete
 * `faculty_evals_tenant_isolation` name and then created `faculty_evals_select`,
 * which 20260923000003 had already created -- so a fresh `supabase db reset`
 * stopped at that file and nothing after it was ever applied.
 *
 * The failure is invisible to any other static check: the SQL is well formed,
 * the policy text is right, and only the ORDER is wrong. This suite replays the
 * migration history in filename order, tracks which policies are live, and
 * fails on any create whose name is already live on that table.
 */

const repoRoot = resolve(process.cwd(), '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

const SECONDARY_WRITES =
  'supabase/migrations/20260927000002_secondary_clinical_privileged_writes.sql';
const CONVERGENCE = 'supabase/migrations/20260923000003_tenant_role_policy_convergence.sql';
const P3_07 = 'supabase/tests/p3_07_secondary_clinical_writes.sql';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * A policy name is either a quoted identifier (which may contain spaces) or
 * bare. Used as `(${POLICY_NAME})` so the name is a single capture group.
 */
const POLICY_NAME = '"(?:[^"]+)"|[A-Za-z_][A-Za-z0-9_$]*';

/**
 * The bare table name. Older migrations write `ON profiles`, later ones
 * `ON public.profiles`; PostgreSQL resolves both to the same relation, so the
 * timeline has to agree or every drop of a legacy name reads as a miss.
 */
function bareTable(qualified: string): string {
  return qualified.toLowerCase().split('.').pop() as string;
}

/**
 * The source with its comments removed.
 *
 * A migration that explains the rule it is enforcing often names the statement
 * it is enforcing it with -- "CREATE POLICY has neither OR REPLACE nor IF NOT
 * EXISTS" -- and a parser that reads that as a policy called `has` invents both
 * a phantom create and a phantom duplicate. Comments are prose; the timeline is
 * built from statements.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

type PolicyEvent =
  | { kind: 'create'; name: string; table: string; at: number }
  | { kind: 'drop'; name: string; table: string; at: number }
  | { kind: 'purge'; table: string; at: number };

/**
 * The policy statements of one migration, in the order they appear.
 *
 * `purge` is the `EXECUTE format('DROP POLICY %I ON <table>', ...)` shape several
 * migrations use to clear every policy on a table before re-asserting the set;
 * without it every one of those files reads as a mass of duplicates.
 */
function policyEvents(sql: string): PolicyEvent[] {
  const source = stripSqlComments(sql);
  const events: PolicyEvent[] = [];
  for (const match of source.matchAll(
    new RegExp(`CREATE\\s+POLICY\\s+(${POLICY_NAME})\\s+ON\\s+([\\w.]+)`, 'gi'),
  )) {
    events.push({
      kind: 'create',
      name: (match[1] as string).replace(/"/g, ''),
      table: bareTable(match[2] as string),
      at: match.index,
    });
  }
  for (const match of source.matchAll(
    new RegExp(`DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?(${POLICY_NAME})\\s+ON\\s+([\\w.]+)`, 'gi'),
  )) {
    events.push({
      kind: 'drop',
      name: (match[1] as string).replace(/"/g, ''),
      table: bareTable(match[2] as string),
      at: match.index,
    });
  }
  for (const match of source.matchAll(/DROP\s+POLICY\s+%I\s+ON\s+([\w."]+)/gi)) {
    events.push({
      kind: 'purge',
      table: bareTable(match[1] as string),
      at: match.index,
    });
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * The policies live after every migration has been applied, keyed `table::name`.
 */
function livePolicyTimeline(): Map<string, string> {
  const live = new Map<string, string>();
  for (const file of migrationFiles()) {
    for (const event of policyEvents(readFileSync(join(migrationsDir, file), 'utf8'))) {
      if (event.kind === 'purge') {
        for (const key of [...live.keys()]) {
          if (key.startsWith(`${event.table}::`)) live.delete(key);
        }
        continue;
      }
      const key = `${event.table}::${event.name}`;
      if (event.kind === 'drop') {
        live.delete(key);
        continue;
      }
      live.set(key, file);
    }
  }
  return live;
}

/** Every create in the history whose policy name is already live on that table. */
function duplicatePolicyCreations(): string[] {
  const live = new Map<string, string>();
  const duplicates: string[] = [];
  for (const file of migrationFiles()) {
    for (const event of policyEvents(readFileSync(join(migrationsDir, file), 'utf8'))) {
      if (event.kind === 'purge') {
        for (const key of [...live.keys()]) {
          if (key.startsWith(`${event.table}::`)) live.delete(key);
        }
        continue;
      }
      const key = `${event.table}::${event.name}`;
      if (event.kind === 'drop') {
        live.delete(key);
        continue;
      }
      const createdIn = live.get(key);
      if (createdIn !== undefined) {
        duplicates.push(
          `${key} is created by ${file} but ${createdIn} already created it and nothing dropped it`,
        );
      }
      live.set(key, file);
    }
  }
  return duplicates;
}

/** The index of the first match, or Infinity when absent. */
function indexOf(source: string, pattern: RegExp): number {
  const match = source.match(pattern);
  return match?.index ?? Number.POSITIVE_INFINITY;
}

describe('policy creation across the migration history', () => {
  it('never creates a policy name that an earlier migration left live', () => {
    // CREATE POLICY is not idempotent: a name that is already live on the table
    // raises duplicate_object and aborts the migration, so everything after it
    // in the file -- and every later file -- is never applied.
    expect(duplicatePolicyCreations()).toEqual([]);
  });

  it('parses the policy statements it is guarding', () => {
    // A parser that silently matched nothing, or that treated `profiles` and
    // `public.profiles` as different relations, would make the check above
    // vacuous in one direction or the other.
    const live = livePolicyTimeline();
    expect(live.size).toBeGreaterThan(20);
    expect(live.has('faculty_evaluations::faculty_evals_select')).toBe(true);
    expect(live.has('faculty_evaluations::faculty_evals_tenant_isolation')).toBe(false);
    // A name that predates schema qualification, and one that a later migration
    // re-asserted after a purge-shaped DROP, both have to read as live.
    expect(live.has('case_templates::Tenant members can read templates')).toBe(true);
    expect(live.has('profiles::Active users can read their own profile')).toBe(true);
  });
});

describe('faculty_evaluations policies in 20260927000002', () => {
  const sql = read(SECONDARY_WRITES);

  it('drops the legacy tenant-isolation name', () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public\.faculty_evaluations;/,
    );
  });

  it('drops the convergence names it is about to reuse', () => {
    // 20260923000003 created these four. Reusing a name without dropping it is
    // the duplicate_object that aborted this migration.
    for (const name of [
      'faculty_evals_select',
      'faculty_evals_insert',
      'faculty_evals_update',
      'faculty_evals_delete',
    ]) {
      expect(sql, `${name} must be dropped before it is recreated`).toMatch(
        new RegExp(`DROP POLICY IF EXISTS ${name} ON public\\.faculty_evaluations;`),
      );
      expect(read(CONVERGENCE), `${name} must exist in the convergence migration`).toMatch(
        new RegExp(`CREATE POLICY ${name}\\b`),
      );
    }
  });

  it('drops every name it creates, so a forward re-run is idempotent', () => {
    const created = policyEvents(sql)
      .filter((event) => event.kind === 'create')
      .map((event) => (event as { name: string }).name);
    expect(created).toEqual([
      'faculty_evals_select',
      'faculty_evals_insert_evaluator',
      'faculty_evals_update_own',
      'faculty_evals_delete_own',
    ]);
    for (const name of created) {
      expect(sql, `${name} must be dropped before it is created`).toMatch(
        new RegExp(`DROP POLICY IF EXISTS ${name} ON public\\.faculty_evaluations;`),
      );
    }
  });

  it('drops each name before it creates it', () => {
    // Order, not presence: a DROP that comes after the CREATE does not help.
    for (const name of [
      'faculty_evals_select',
      'faculty_evals_insert_evaluator',
      'faculty_evals_update_own',
      'faculty_evals_delete_own',
    ]) {
      const dropped = indexOf(
        sql,
        new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+${name}\\s+ON`),
      );
      const createdAt = indexOf(sql, new RegExp(`CREATE\\s+POLICY\\s+${name}\\b`));
      expect(dropped, `${name} must be dropped`).toBeLessThan(Number.POSITIVE_INFINITY);
      expect(createdAt, `${name} must be created`).toBeGreaterThan(-1);
      expect(dropped, `${name} must be dropped before it is created`).toBeLessThan(createdAt);
    }
  });

  it('never revives the tenant-wide FOR ALL policy it is replacing', () => {
    // p3_07 asserts from the catalog that no unconditional policy remains. Here
    // it is asserted from the source that would otherwise reintroduce one: every
    // policy this migration creates on faculty_evaluations has to carry a tenant
    // predicate, so a FOR ALL shape cannot come back under a new name.
    const created = policyEvents(sql).filter((event) => event.kind === 'create');
    expect(created.length).toBeGreaterThanOrEqual(4);
    for (const event of created) {
      const name = (event as { name: string }).name;
      const start = indexOf(sql, new RegExp(`CREATE\\s+POLICY\\s+${name}\\b`));
      const body = sql.slice(start, start + 700);
      expect(body, `${name} must be scoped by tenant`).toMatch(/tenant_id/);
      expect(body, `${name} must not be a bare FOR ALL policy`).not.toMatch(
        /USING\s*\(\s*true\s*\)/i,
      );
    }
    expect(read(P3_07)).toContain('no unconditional tenant-wide policy remains');
  });
});
