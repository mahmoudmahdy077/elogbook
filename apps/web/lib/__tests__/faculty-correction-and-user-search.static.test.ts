import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for the two medium security decisions closed by
 * 20260929000001 and 20260929000002.
 *
 * The live proofs are pgTAP (p3_09, p3_10), which need a database. This suite
 * needs only the repository, so it runs wherever the code is written and it fails
 * when a migration is edited into something the live suite would have refused --
 * a dropped REVOKE, a search_path unpinned, the write-once rule narrowed back to
 * the evaluator only, or a suite that starts pinning the old unsafe behaviour as
 * if it were correct.
 *
 * It is deliberately a set of assertions about the SHAPE of the SQL and of the
 * TypeScript that calls it, not a second implementation of it. Anything that
 * needs to know what the database would actually do belongs in pgTAP.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/**
 * The source with its comments removed. A comment that NAMES the construct it
 * exists to forbid -- `.or('full_name.ilike.%t%')` is the whole reason the search
 * moved into the database -- must not read as a use of it.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

const SEARCH_MIGRATION = 'supabase/migrations/20260929000001_admin_user_search_rpc.sql';
const CORRECTION_MIGRATION = 'supabase/migrations/20260929000002_faculty_evaluation_correction.sql';
const SEARCH_TEST = 'supabase/tests/p3_09_admin_user_search.sql';
const CORRECTION_TEST = 'supabase/tests/p3_10_faculty_evaluation_correction.sql';
const USERS_ROUTE = 'apps/web/app/api/[tenant]/admin/users/route.ts';
const CORRECTION_ROUTE = 'apps/web/app/api/[tenant]/admin/faculty-evaluations/correct/route.ts';

/** Everything between `CREATE OR REPLACE FUNCTION <name>` and the next `$$;`. */
function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} must exist in the migration`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${signature} must be terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('admin user search', () => {
  const migration = read(SEARCH_MIGRATION);

  it('is a forward-only migration, not an edit to applied history', () => {
    // The 2026081x-era migrations that introduced the .or() search are applied and
    // immutable; the repair is a new file an installation picks up by re-running
    // the newest migration.
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.search_users\(/);
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration).not.toMatch(/DROP FUNCTION/i);
  });

  it('runs as the definer with a pinned search_path', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = ''/);
  });

  it('pins a search_path p1_16 will accept on every function it defines', () => {
    for (const [, definer] of migration.matchAll(
      /SECURITY DEFINER\s*\n(?:\s*--[^\n]*\n)*\s*SET search_path = ([^\n]+)/g
    )) {
      const path = definer.trim();
      expect(
        path === "''" || /^pg_catalog, public, pg_temp$/.test(path),
        `search_path "${path}" is not the shape p1_16 accepts`
      ).toBe(true);
    }
  });

  it('resolves the tenant from the authoritative principal and checks the argument', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    // The gate checks the argument against the principal...
    expect(body).toMatch(/require_active_principal\(/);
    // ...and the row filter uses the principal's own resolved tenant, never the
    // argument, so the failure path cannot read another tenant either.
    expect(body).toMatch(/INTO v_tenant\s*\n\s*FROM public\.get_authoritative_principal\(\)/);
    expect(body).toMatch(/candidate\.tenant_id = v_tenant/);
    expect(body).not.toMatch(/candidate\.tenant_id = p_tenant_id/);
  });

  it('matches the term as a bound parameter against both columns', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    expect(body).toMatch(/candidate\.full_name ILIKE v_pattern ESCAPE v_escape/);
    expect(body).toMatch(/candidate\.specialty ILIKE v_pattern ESCAPE v_escape/);
    // Escaped, not forbidden: the wildcards are data.
    expect(body).toMatch(/replace\(/);
    // Nothing may concatenate the caller's term into SQL text.
    expect(body).not.toMatch(/EXECUTE\s+format\(/i);
    expect(body).not.toMatch(/EXECUTE\s+[^;]*\|/i);
  });

  it('bounds the page and clamps an over-long term', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    expect(body).toMatch(/LEAST\(GREATEST\(COALESCE\(p_page, 1\), 1\), 100000\)/);
    expect(body).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 20\), 1\), 100\)/);
    expect(body).toMatch(/char_length\(v_term\) > 64/);
  });

  it('refuses a filter outside the known set rather than ignoring it', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    // Ignoring an unknown role would return a wider set than the caller asked for.
    expect(body).toMatch(/v_role_filter NOT IN \(/);
    expect(body).toMatch(/v_status_filter NOT IN \(/);
    expect(body).toMatch(/ERRCODE = '22023'/);
  });

  it('returns only the non-sensitive projection', () => {
    const body = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.search_users(');
    const outColumns = body.slice(body.indexOf('RETURNS TABLE'), body.indexOf('LANGUAGE plpgsql'));
    for (const column of [
      'id', 'user_id', 'tenant_id', 'role', 'full_name', 'specialty',
      'status', 'created_at', 'last_login_at', 'deactivated_at', 'total_count',
    ]) {
      expect(outColumns, `${column} must be projected`).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const forbidden of ['email', 'phone', 'invited_by', 'pending_role', 'deleted_at']) {
      expect(outColumns, `${forbidden} must not be projected`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`)
      );
    }
    // The inactive-row predicate the RLS read applied is applied explicitly here.
    expect(body).toMatch(/profile_row_is_active\(to_jsonb\(candidate\)\)/);
  });

  it('grants authenticated and nobody else', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.search_users\([^)]*\) FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.search_users\([^)]*\) TO authenticated;/
    );
  });

  it('the route sends the term as a value and never as a filter grammar', () => {
    const route = read(USERS_ROUTE);
    const body = code(USERS_ROUTE);
    expect(route).toMatch(/supabase\.rpc\('search_users'/);
    expect(route).toMatch(/p_search: search/);
    // The whole failure mode this replaced.
    expect(body).not.toMatch(/\.or\(/);
    expect(body).not.toMatch(/ilike/);
    // And no character class standing in for "a person's name".
    expect(body).not.toMatch(/SEARCH_ALLOWED/);
  });

  it('keeps the no-search read on the tenant-scoped builder path', () => {
    const body = code(USERS_ROUTE);
    // The RLS read it replaced was already safe, so there is nothing to move.
    expect(body).toMatch(/\.eq\('tenant_id', profile\.tenant_id\)/);
    expect(body).toMatch(/if \(search !== null\)/);
  });

  it('the pgTAP suite is planned, ordered and asserts the behaviour, not a mock', () => {
    const test = read(SEARCH_TEST);
    const plan = Number(test.match(/SELECT plan\((\d+)\)/)?.[1] ?? 0);
    const assertions = [
      ...test.matchAll(
        /^[ \t]*SELECT[ \t]+(?:isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim
      ),
    ].length;
    expect(plan).toBeGreaterThan(0);
    expect(assertions).toBe(plan);
    for (const behaviour of [
      "O'Brien",
      'Dr. Smith',
      'cardiology',
      'underscore',
      'clamped',
      'another tenant',
    ]) {
      expect(test, `${behaviour} must be asserted`).toContain(behaviour);
    }
  });
});

describe('faculty evaluation correction', () => {
  const migration = read(CORRECTION_MIGRATION);

  it('runs as the definer with a pinned search_path', () => {
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = ''/);
  });

  it('requires a live AAL2 privileged principal in the caller own tenant', () => {
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    // The third argument is p_require_aal2, and it must be TRUE.
    expect(body).toMatch(
      /require_privileged_principal\(\s*ARRAY\['supervisor', 'director', 'institution_admin', 'admin'\]::TEXT\[\],\s*p_tenant_id,\s*TRUE\s*\)/
    );
    expect(body).toMatch(/v_principal\.tenant_id IS DISTINCT FROM p_tenant_id/);
    // The target row is looked up inside the principal tenant, so a row in another
    // tenant is not found rather than refused.
    expect(body).toMatch(/target\.tenant_id = v_principal\.tenant_id/);
  });

  it('requires a bounded reason', () => {
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    expect(body).toMatch(/'reason_required'/);
    expect(body).toMatch(/char_length\(v_reason\) < 8/);
    expect(body).toMatch(/char_length\(v_reason\) > 1000/);
  });

  it('records the original scores immutably alongside the corrected ones', () => {
    expect(migration).toMatch(
      /original_clinical_skills INTEGER CHECK \(original_clinical_skills BETWEEN 1 AND 5\)/
    );
    expect(migration).toMatch(
      /corrected_clinical_skills INTEGER CHECK \(corrected_clinical_skills BETWEEN 1 AND 5\)/
    );
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    // The pre-correction values are read from the locked row and written to the
    // record, not recomputed afterwards.
    expect(body).toMatch(/v_target\.clinical_skills,/);
    expect(body).toMatch(/v_target\.professionalism,/);
    expect(body).toMatch(/v_target\.procedures,/);
  });

  it('makes the correction history append-only for every caller', () => {
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.refuse_faculty_evaluation_correction_mutation()'
    );
    // Unconditional: no branch, no principal check, no escape hatch.
    expect(body).toMatch(/RAISE EXCEPTION 'SEC-014/);
    expect(body).not.toMatch(/auth\.uid\(\)/);
    expect(migration).toMatch(
      /CREATE TRIGGER trg_faculty_eval_correction_append_only\s+BEFORE UPDATE OR DELETE ON public\.faculty_evaluation_corrections/
    );
  });

  it('pins a search_path p1_16 will accept on every function it defines', () => {
    // p1_16 requires each public SECURITY DEFINER to have exactly one search_path
    // setting, either empty or pg_catalog-first with pg_temp last. The guard this
    // migration redefines previously carried `public, pg_catalog`, which that gate
    // flags; asserting the shape here means a later edit cannot quietly reintroduce
    // it without a red build.
    for (const [, definer] of migration.matchAll(
      /SECURITY DEFINER\s*\n(?:\s*--[^\n]*\n)*\s*SET search_path = ([^\n]+)/g
    )) {
      const path = definer.trim();
      expect(
        path === "''" || /^pg_catalog, public, pg_temp$/.test(path),
        `search_path "${path}" is not the shape p1_16 accepts`
      ).toBe(true);
    }
    // And the guard this migration redefines lands on the compliant shape.
    const guard = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()'
    );
    expect(guard).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
  });

  it('locks the history table away from every client role', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.faculty_evaluation_corrections ENABLE ROW LEVEL SECURITY;/
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.faculty_evaluation_corrections FORCE ROW LEVEL SECURITY;/
    );
    // A policy would be a client door; there must be none.
    expect(migration).not.toMatch(/CREATE POLICY[^\n]*faculty_evaluation_corrections/i);
    expect(migration).not.toMatch(/GRANT[^\n]*ON (?:TABLE )?public\.faculty_evaluation_corrections/i);
  });

  it('keeps the history typed rather than giving it a free-form bag', () => {
    // The record is a reason and the before/after values, all typed. A JSONB column
    // the command writes unvalidated is a column something else can later read as a
    // score, so there is deliberately not one.
    const table = migration.slice(
      migration.indexOf('CREATE TABLE public.faculty_evaluation_corrections'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_faculty_eval_corrections_evaluation')
    );
    expect(table).not.toMatch(/JSONB/);
    expect(table).toMatch(/reason TEXT NOT NULL CHECK/);
    expect(table).toMatch(/idempotency_key TEXT CHECK/);
  });

  it('is idempotent, and a reused key is a conflict rather than an overwrite', () => {
    expect(migration).toMatch(
      /UNIQUE \(tenant_id, idempotency_key\)/
    );
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    expect(body).toMatch(/'idempotency_conflict'/);
    expect(body).toMatch(/'replayed', true/);
  });

  it('writes a metadata-only audit row that does not carry the free-text reason', () => {
    const body = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation('
    );
    expect(body).toMatch(/INSERT INTO public\.audit_logs/);
    const auditInsert = body.slice(body.indexOf('INSERT INTO public.audit_logs'));
    expect(auditInsert).toMatch(/'corrected_clinical_skills', v_clinical_skills/);
    // audit_logs is a metadata-only surface (20260927000000). The reason is on the
    // append-only correction record, where it can be read in full.
    expect(auditInsert).not.toMatch(/'reason', v_reason/);
  });

  it('grants authenticated and nobody else', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.correct_faculty_evaluation\([^)]*\) FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.correct_faculty_evaluation\([^)]*\) TO authenticated;/
    );
  });

  it('closes the privileged bypass the write guard had', () => {
    const guard = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()'
    );
    // The privileged branch required AAL2 but returned NEW unconditionally, so
    // SEC-011 was really an evaluator rule. The write-once refusal has to sit
    // inside that branch now, not only in the evaluator one.
    const privilegedBranch = guard.slice(guard.indexOf("v_role IN ('supervisor'"));
    expect(privilegedBranch).toMatch(/IF v_scores_changed THEN/);
    expect(privilegedBranch).toMatch(/SEC-011/);
    // And the command exception is recognised by a record, not by the flag alone.
    const commandBranch = guard.slice(guard.indexOf('v_scores_changed\n     AND COALESCE'));
    expect(commandBranch).toBeTruthy();
    expect(guard).toMatch(/FROM public\.faculty_evaluation_corrections AS correction/);
    expect(guard).toMatch(/correction\.corrected_by = v_actor/);
    expect(guard).toMatch(/correction\.created_at >= transaction_timestamp\(\)/);
    // A record cannot be replayed to move a score a second time.
    expect(guard).toMatch(/OLD\.clinical_skills IS DISTINCT FROM correction\.corrected_clinical_skills/);
  });

  it('keeps the write-once rule defined in exactly one migration', () => {
    // The guard is redefined by the correction migration; if a later file also
    // redefines it, the two definitions have to agree and this suite cannot prove
    // it. Flag it rather than let the divergence pass unnoticed.
    expect(guardTriggerMigrations()).toEqual([
      '20260927000002_secondary_clinical_privileged_writes.sql',
      '20260929000002_faculty_evaluation_correction.sql',
    ]);
  });

  it('does not re-encode the old unsafe behaviour as an expectation', () => {
    // p3_07 is the suite that would have to change if the privileged branch had
    // been left alone. It must keep asserting refusals only.
    const p307 = read('supabase/tests/p3_07_secondary_clinical_writes.sql');
    const livesStatements = [...p307.matchAll(/lives_ok\(\s*\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
    for (const statement of livesStatements) {
      expect(
        /faculty_evaluations[\s\S]*SET\s+(clinical_skills|professionalism|procedures)/i.test(statement),
        `p3_07 must not assert that a caller may re-score a faculty evaluation: ${statement.trim()}`
      ).toBe(false);
    }
    // And the same for the duty/faculty RLS suite.
    const p203 = read('supabase/tests/p2_03_duty_faculty_rls.sql');
    expect(p203).toMatch(/faculty_evaluations/);
  });

  it('the route is a thin door onto the command, not a second policy', () => {
    const body = code(CORRECTION_ROUTE);
    expect(body).toMatch(/supabase\.rpc\('correct_faculty_evaluation'/);
    // The tenant comes from the resolved principal, never from the request body.
    expect(body).toMatch(/p_tenant_id: profile\.tenant_id/);
    expect(body).not.toMatch(/tenant_id:\s*guarded\.data/);
    expect(body).not.toMatch(/tenant_id:\s*body/);
    // AAL2 is enforced by requireTenantAdmin, which requires it by default.
    expect(body).toMatch(/requireTenantAdmin/);
    expect(body).toMatch(/CORRECTION_ROLES/);
    // No direct table write anywhere in the route.
    expect(body).not.toMatch(/\.from\(/);
    expect(body).not.toMatch(/\.update\(/);
  });

  it('the pgTAP suite is planned and covers the refusals, not just the happy path', () => {
    const test = read(CORRECTION_TEST);
    const plan = Number(test.match(/SELECT plan\((\d+)\)/)?.[1] ?? 0);
    const assertions = [
      ...test.matchAll(
        /^[ \t]*SELECT[ \t]+(?:isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim
      ),
    ].length;
    expect(plan).toBeGreaterThan(0);
    expect(assertions).toBe(plan);
    for (const behaviour of [
      'AAL1',
      'reason_required',
      'another tenant',
      'idempotency_conflict',
      'a forged correction flag',
      'not even by the table owner',
    ]) {
      expect(test, `${behaviour} must be asserted`).toContain(behaviour);
    }
  });
});

/** The migrations that define the faculty evaluation write guard, in order. */
function guardTriggerMigrations(): string[] {
  return readdirSync(join(repoRoot, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .filter((name) =>
      read(`supabase/migrations/${name}`).includes(
        'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()'
      )
    )
    .sort();
}
