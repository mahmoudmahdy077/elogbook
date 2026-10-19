import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for the guarantees 20260929000002 states about
 * `faculty_evaluations` and does not fully implement.
 *
 * The migration documents that scores are write-once for every caller and that
 * the correction command is the only supported way to move one, and its section
 * header claims a DELETE AAL2 guard. Two gaps sit between the documented
 * contract and the SQL:
 *
 *   * the privileged branch required AAL2 and then annotated freely, so an AAL2
 *     supervisor could also retarget `resident_id`, `evaluator_id` or
 *     `tenant_id` -- rewriting whose assessment a row is, which is a larger
 *     claim than correcting a score and leaves no correction record;
 *   * the guard is attached `BEFORE INSERT OR UPDATE`, so nothing enforced the
 *     documented DELETE rule at all.
 *
 * The live proofs are pgTAP (p3_10), which need a database. This suite needs
 * only the repository, so a later edit that narrows either guarantee back fails
 * here rather than silently in production.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

const CORRECTION_MIGRATION =
  'supabase/migrations/20260929000002_faculty_evaluation_correction.sql';
const SECONDARY_WRITES =
  'supabase/migrations/20260927000002_secondary_clinical_privileged_writes.sql';
const P3_10 = 'supabase/tests/p3_10_faculty_evaluation_correction.sql';
const P3_08 = 'supabase/tests/p3_08_case_trigger_state.sql';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** Everything from `signature` to the `$$;` that closes its body. */
function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} must exist in the migration`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${signature} must be terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/**
 * A function body with its comments removed.
 *
 * A comment that NAMES the construct it exists to enforce -- "check it before
 * any branch so a privileged caller cannot reorder past it" -- sits between the
 * statement it describes and the statement it describes. Matching the shape with
 * the prose in the way would make the assertion about formatting, not order.
 */
function code(sql: string, signature: string): string {
  return functionBody(sql, signature)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

function pgTapPlan(sql: string): number {
  return Number(sql.match(/^[ \t]*SELECT[ \t]+plan[ \t]*\([ \t]*(\d+)[ \t]*\)/im)?.[1] ?? 0);
}

function pgTapAssertions(sql: string): number {
  return [
    ...sql.matchAll(
      /^[ \t]*SELECT[ \t]+(?:isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim,
    ),
  ].length;
}

const migration = read(CORRECTION_MIGRATION);
const guard = code(
  migration,
  'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()',
);

describe('the subject, the evaluator and the tenant are immutable on update', () => {
  it('refuses a retarget before any branch is consulted', () => {
    expect(guard).toMatch(
      /IF TG_OP = 'UPDATE' THEN IF NEW\.resident_id IS DISTINCT FROM OLD\.resident_id OR NEW\.evaluator_id IS DISTINCT FROM OLD\.evaluator_id OR NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id THEN RAISE EXCEPTION 'SEC-015[^']*' USING ERRCODE = 'insufficient_privilege'; END IF;/,
    );
  });

  it('refuses it before the privileged branch and before the correction exception', () => {
    // Order is the guarantee. A check that sat inside the evaluator branch, or
    // after the correction branch, would leave an AAL2 supervisor free to
    // retarget -- which is exactly the shape the correction record cannot
    // account for, since it records scores and not a subject.
    const retarget = guard.indexOf("'SEC-015");
    const correction = guard.indexOf('FROM public.faculty_evaluation_corrections AS correction');
    const privileged = guard.indexOf("v_role IN ('supervisor'");
    expect(retarget).toBeGreaterThan(-1);
    expect(correction).toBeGreaterThan(-1);
    expect(privileged).toBeGreaterThan(-1);
    expect(retarget).toBeLessThan(correction);
    expect(retarget).toBeLessThan(privileged);
  });

  it('leaves the correction command writing only the score columns', () => {
    // The immutability is a property of the columns, so the command that is
    // allowed to move them must not name the immutable ones. Only the SET list
    // is read: the WHERE clause legitimately repeats the row's tenant.
    const command = code(
      migration,
      'CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation(',
    );
    const set = command.slice(
      command.lastIndexOf('UPDATE public.faculty_evaluations'),
      command.lastIndexOf('WHERE id = v_target.id'),
    );
    expect(set).toMatch(/SET clinical_skills = v_clinical_skills,/);
    expect(set).toMatch(/professionalism = v_professionalism,/);
    expect(set).toMatch(/procedures = v_procedures,/);
    expect(set).not.toMatch(/resident_id/);
    expect(set).not.toMatch(/evaluator_id/);
    expect(set).not.toMatch(/tenant_id/);
  });
});

describe('the subject has no write path into the table', () => {
  it('refuses an evaluator who is also the subject, on insert as on update', () => {
    // The evaluator branch returned NEW on INSERT before anything else, so a
    // resident who named themselves as the evaluator filed their own
    // assessment -- the one write this table's contract says the subject has no
    // path to, and the one that feeds resident_evaluation_averages.
    expect(guard).toMatch(
      /IF v_actor IS NOT NULL AND NEW\.evaluator_id = v_actor THEN IF NEW\.resident_id = v_actor THEN RAISE EXCEPTION 'SEC-016[^']*' USING ERRCODE = 'insufficient_privilege'; END IF;/,
    );
    expect(guard.indexOf("'SEC-016")).toBeLessThan(guard.indexOf("IF TG_OP = 'INSERT' THEN"));
  });

  it('applies the same refusal in the migration that introduced the evaluator branch', () => {
    // The branch is defined twice; the final state is the correction migration's,
    // but a forward replay that stops at 20260927000002 must not be the weaker
    // one.
    const earlier = code(
      read(SECONDARY_WRITES),
      'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()',
    );
    expect(earlier).toMatch(/NEW\.resident_id = v_actor/);
  });
});

describe('the documented DELETE AAL2 guard exists', () => {
  it('is a BEFORE DELETE trigger, not only a comment about one', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.authorize_faculty_evaluation_delete\(\)/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER trg_authorize_faculty_eval_delete\s+BEFORE DELETE ON public\.faculty_evaluations/,
    );
    // Idempotent on a forward re-run, like its sibling.
    expect(migration).toMatch(
      /DROP TRIGGER IF EXISTS trg_authorize_faculty_eval_delete ON public\.faculty_evaluations;/,
    );
  });

  it('requires a live AAL2 privileged principal for a non-evaluator', () => {
    const del = code(
      migration,
      'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_delete()',
    );
    expect(del).toMatch(/privileged_clinical_write_authorized\(OLD\.tenant_id\)/);
    expect(del).toMatch(/OLD\.evaluator_id = v_actor/);
    // The maintenance path, stated rather than assumed: a migration replay and a
    // retention job have no request JWT, and are governed by their own checks.
    expect(del).toMatch(/IF auth\.uid\(\) IS NULL THEN RETURN OLD; END IF;/);
    expect(del).toMatch(/insufficient_privilege/);
  });

  it('pins a search_path p1_16 will accept and stays out of client reach', () => {
    const del = functionBody(
      migration,
      'CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_delete()',
    );
    expect(del).toMatch(/SECURITY DEFINER/);
    expect(del).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.authorize_faculty_evaluation_delete\(\) FROM PUBLIC, anon;/,
    );
  });

  it('is asserted from the live catalog as well as from the source', () => {
    // p3_08 is the suite that reads pg_trigger, so a guard that exists in the
    // migration but is disabled in the database still fails there.
    const p308 = read(P3_08);
    expect(p308).toContain('faculty_evaluations:trg_authorize_faculty_eval_delete');
    expect(p308).toContain('authorize_faculty_evaluation_delete');
    expect(pgTapPlan(p308)).toBeGreaterThan(0);
    expect(pgTapAssertions(p308)).toBe(pgTapPlan(p308));
  });
});

describe('p3_10 states the guarantees it is supposed to be proving', () => {
  const p310 = read(P3_10);

  it('proves retargeting, DELETE and correction immutability', () => {
    for (const behaviour of [
      'a privileged update cannot retarget the subject',
      'a privileged update cannot retarget the evaluator',
      'cannot move an evaluation to another tenant',
      'an evaluator cannot retarget their own evaluation',
      'an AAL1 privileged principal cannot delete',
      'an AAL2 privileged principal can delete',
      'the evaluator can delete their own',
      'the subject cannot delete the record of their own assessment',
      'a forged correction flag cannot retarget',
    ]) {
      expect(p310, `${behaviour} must be asserted`).toContain(behaviour);
    }
  });

  it('still plans exactly the assertions it contains', () => {
    expect(pgTapPlan(p310)).toBeGreaterThan(0);
    expect(pgTapAssertions(p310)).toBe(pgTapPlan(p310));
  });
});
