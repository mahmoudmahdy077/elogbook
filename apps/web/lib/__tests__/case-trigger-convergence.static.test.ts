import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration guard window: 20260824160000 -> 20260825190000.
 *
 * 20260824160000 re-asserted the case_entries PHI-scan trigger, and
 * 20260825190000 re-enabled the set of case_entries triggers that an
 * experiment had left disabled. Between them, several migrations ran against a
 * table whose triggers were in an unverified state, and a trigger that is
 * `DISABLE`d in a migration is invisible to every read of this repository: the
 * applied database is the only place it shows up.
 *
 * A guard window of that shape is closed by an assertion, not by re-ordering
 * history. The applied migrations are immutable, so this pins the FINAL state
 * instead: a forward-only convergence migration that refuses to complete unless
 * every guard trigger on the clinical tables is enabled, plus a pgTAP
 * assertion that reads `pg_trigger.tgenabled` from the live catalog.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

/** The authoritative de-identified PHI boundary, by file. */
const AUTHORITATIVE_PHI_MIGRATION =
  'supabase/migrations/20260925000004_phi_boundary_reassert.sql';
const CONVERGENCE_MIGRATION =
  'supabase/migrations/20260927000003_case_trigger_convergence_guard.sql';
const REPAIR_MIGRATION =
  'supabase/migrations/20260930000001_clinical_tombstone_insert_and_phi_convergence.sql';
const INSERT_AAL2_MIGRATION =
  'supabase/migrations/20260930000002_evaluation_form_insert_aal2.sql';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** A function body, from its signature to the `$$;` that closes it. */
function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} must exist`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${signature} must be terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('case_entries trigger convergence', () => {
  const guardTriggerNames = [
    'set_updated_at',
    'trg_audit_case_entry',
    'trg_auto_approve_individual',
    'trg_block_lapsed_tenant_submit',
    'trg_enforce_case_quota',
    'trg_enforce_case_status_transition',
    'trg_scan_field_values_phi',
    'trg_update_goal_progress',
    'trg_write_once_submitted_check',
  ];

  it('20260825190000 re-enabled every case_entries guard trigger it names', () => {
    const migration = read('supabase/migrations/20260825190000_reenable_triggers_and_cleanup.sql');
    for (const name of guardTriggerNames) {
      expect(migration, `${name} must be re-enabled by the convergence migration`).toContain(
        `ALTER TABLE public.case_entries ENABLE TRIGGER ${name};`,
      );
    }
  });

  it('a forward-only migration asserts the final trigger state instead of relying on history', () => {
    const guard = read(CONVERGENCE_MIGRATION);
    // Forward-only: it adds a new file rather than editing 20260824160000 or
    // 20260825190000, so an installation that already applied those is repaired
    // by re-running the newest one.
    expect(guard).toMatch(/pg_trigger/);
    expect(guard).toMatch(/tgenabled/);
    // A disabled trigger on a clinical table is a silent loss of a control, so
    // the guard raises rather than warning.
    expect(guard).toMatch(/RAISE EXCEPTION/);

    // The only trigger this migration may drop is the one it also redefines and
    // recreates. Dropping a guard owned by a later migration would fork the
    // definition the tests assert against.
    const dropped = [...guard.matchAll(/DROP TRIGGER IF EXISTS (\w+) ON/g)].map((match) => match[1]);
    expect(dropped).toEqual(['trg_scan_field_values_phi']);
    expect(guard).toContain('CREATE TRIGGER trg_scan_field_values_phi');
    for (const name of dropped) {
      expect(guard).toContain(`CREATE TRIGGER ${name}`);
    }
  });

  it('re-issues the authoritative PHI scan body rather than a weaker one', () => {
    // The downgrade this guards against replaced the recursive walk with an
    // inline three-regex check. It detected a bare digit run and two date
    // shapes and nothing else: an email address, a telephone number, a labelled
    // MRN and an unknown key all passed it. A trigger that exists and is
    // enabled is not a control, so the body is asserted from the source.
    const authoritative = functionBody(
      read(AUTHORITATIVE_PHI_MIGRATION),
      'CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi()',
    );
    for (const migration of [CONVERGENCE_MIGRATION, REPAIR_MIGRATION]) {
      const body = functionBody(
        read(migration),
        'CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi()',
      );
      expect(body, `${migration} must walk the recursive detector`).toContain(
        'public.field_values_contain_phi(NEW.field_values)',
      );
      expect(body, `${migration} must keep SECURITY DEFINER`).toContain('SECURITY DEFINER');
      expect(body, `${migration} must keep the pinned search_path`).toContain(
        'SET search_path = pg_catalog, public, pg_temp',
      );
      // The downgrade's own text. Naming it is not the same as reading it: a
      // comment that explains the forbidden check must not read as a use of it,
      // so these are matched against the code with comments stripped.
      const code = body.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
      expect(code, `${migration} must not inline the weaker regex`).not.toContain(
        "v_text ~ '\\m\\d{6,}\\m'",
      );
      expect(code, `${migration} must not scan the raw jsonb text`).not.toContain(
        'NEW.field_values::text',
      );
      // Same body, not merely the same shape: a fork here is how two
      // environments end up with two different PHI boundaries.
      expect(normalize(body), `${migration} must re-issue the authoritative body verbatim`).toBe(
        normalize(authoritative),
      );
    }
  });

  it('keeps the PHI detectors out of reach of client roles', () => {
    // Exposing them would invite treating PHI detection as a supported API, and
    // an unknown-key probe is exactly what a caller would script.
    const repair = read(REPAIR_MIGRATION);
    for (const signature of [
      'public.scan_field_values_for_phi()',
      'public.ai_text_contains_phi(TEXT)',
      'public.ai_field_value_is_safe(JSONB, TEXT)',
      'public.field_values_contain_phi(JSONB)',
    ]) {
      expect(repair, `${signature} must be revoked from every client role`).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
      );
    }
  });

  it('re-enables the secondary clinical guards rather than leaving them assumed', () => {
    const guard = read(CONVERGENCE_MIGRATION);
    for (const statement of [
      'ALTER TABLE public.evaluation_forms ENABLE TRIGGER trg_authorize_evalforms_update;',
      'ALTER TABLE public.evaluation_forms ENABLE TRIGGER trg_eval_form_status;',
      'ALTER TABLE public.faculty_evaluations ENABLE TRIGGER trg_authorize_faculty_eval_write;',
      'ALTER TABLE public.rotations ENABLE TRIGGER trg_authorize_rotation_write;',
    ]) {
      expect(guard).toContain(statement);
    }
  });

  it('gates a privileged evaluation filing on AAL2, not only a privileged edit', () => {
    // SEC-010 is attached to the privileged branch of both directions. The
    // update guard alone left a one-request bypass: the RLS insert policy admits
    // a supervisor at any assurance level, and the status guard permits
    // status='completed' on insert by design.
    const migration = read(INSERT_AAL2_MIGRATION);
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.authorize_evaluation_form_insert()');
    expect(migration).toContain(
      'CREATE TRIGGER trg_authorize_evalforms_insert\n  BEFORE INSERT ON public.evaluation_forms',
    );
    expect(migration).toContain('privileged_clinical_write_authorized(NEW.tenant_id)');
    // The refusal is the control, so it must be an explicit refusal.
    expect(migration).toContain('SEC-010: filing an evaluation requires re-authentication at AAL2');
    expect(migration).toContain('SEC-016: the subject of an evaluation cannot file it');
    // The insert guard is asserted in the live-catalog convergence block, and so
    // is the correction ledger, which was introduced after that block was written.
    expect(migration).toContain("'evaluation_forms:trg_authorize_evalforms_insert'");
    expect(migration).toContain(
      "'faculty_evaluation_corrections:trg_faculty_eval_correction_append_only'",
    );
    expect(migration).toContain(
      'ALTER TABLE public.faculty_evaluation_corrections ENABLE TRIGGER trg_faculty_eval_correction_append_only',
    );
  });

  it('covers the privileged evaluation filing in the pgTAP suite', () => {
    const test = read('supabase/tests/p3_07_secondary_clinical_writes.sql');
    expect(test).toContain('AAL1 supervisor cannot file a completed evaluation');
    expect(test).toContain('AAL2 supervisor can file a completed evaluation');
    expect(test).toContain('the refused AAL1 evaluation filing persisted nothing');
  });

  it('the pgTAP suite asserts the live catalog agrees', () => {
    const test = read('supabase/tests/p3_08_case_trigger_state.sql');
    expect(test).toMatch(/SELECT plan\(\d+\)/);
    expect(test).toMatch(/tgenabled/);
    for (const name of guardTriggerNames) {
      expect(test, `${name} must be asserted in the catalog test`).toContain(name);
    }
    // The two UPDATE-only guards are named as BEFORE UPDATE, and the test says
    // why: an INSERT has no previous row for a state machine or a write-once
    // guard to compare against, so binding them there would read like a control
    // while deciding nothing.
    expect(test).toContain(
      'CREATE TRIGGER trg_enforce_case_status_transition BEFORE UPDATE ON public.case_entries',
    );
    expect(test).toContain(
      'CREATE TRIGGER trg_write_once_submitted_check BEFORE UPDATE ON public.case_entries',
    );
    expect(test).not.toContain('trg_enforce_case_status_transition BEFORE INSERT OR UPDATE');
    expect(test).toContain('the PHI scan walks the recursive field_values_contain_phi detector');
  });

  it('does not edit applied history to reorder the guard window', () => {
    // 20260824160000 (the PHI-scan re-assertion) must still be the file that was
    // applied; a later migration converging the state is the only permitted
    // repair.
    const phiScan = read('supabase/migrations/20260824160000_reassert_phi_scan_trigger.sql');
    expect(phiScan).toContain('CREATE TRIGGER trg_scan_field_values_phi');
    expect(phiScan).not.toContain('DISABLE TRIGGER');
  });

  it('inventories the INSERT-side status guard, not only the UPDATE-side ones', () => {
    // 20260826190000 creates trg_case_insert_status AFTER 20260825190000 ran, so
    // that re-enable pass cannot name it and applied history is not edited to
    // say it did. SEC-002's INSERT half is therefore asserted only if the
    // forward convergence file names it -- and a guard that is enabled but left
    // out of the catalog assertion is the exact failure mode this migration
    // exists to prevent, so both the ALTER and the inventory are required.
    const guard = read(CONVERGENCE_MIGRATION);
    expect(guard).toContain('ALTER TABLE public.case_entries ENABLE TRIGGER trg_case_insert_status;');
    expect(inventory(guard)).toContain('trg_case_insert_status');

    // The repair pass is not rewritten to claim it.
    const repair = read('supabase/migrations/20260825190000_reenable_triggers_and_cleanup.sql');
    expect(repair).not.toContain('trg_case_insert_status');

    // And the live catalog suite reads the same inventory, so a database where
    // the insert guard is disabled is caught by pgTAP as well.
    expect(inventory(read('supabase/tests/p3_08_case_trigger_state.sql'))).toContain(
      'trg_case_insert_status',
    );
  });

  it('the pgTAP catalog suite plans exactly the assertions it makes', () => {
    // The insert guard adds assertions to p3_08; a plan that drifts from the
    // count is a suite that passes without proving what it claims.
    const test = read('supabase/tests/p3_08_case_trigger_state.sql');
    const plan = Number(test.match(/SELECT plan\((\d+)\)/)?.[1] ?? 0);
    const assertions = [
      ...test.matchAll(
        /^[ \t]*SELECT[ \t]+(?:isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim,
      ),
    ].length;
    expect(plan).toBeGreaterThan(0);
    expect(assertions).toBe(plan);
  });
});

/** Whitespace-insensitive body text, for a verbatim comparison. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** The names inside the first `unnest(ARRAY[ ... ])` inventory in a file. */
function inventory(sql: string): string[] {
  const start = sql.indexOf('unnest(ARRAY[');
  expect(start, 'the file must carry an unnest(ARRAY[...]) inventory').toBeGreaterThan(-1);
  const end = sql.indexOf('])', start);
  expect(end, 'the inventory must be terminated').toBeGreaterThan(start);
  return [...sql.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}
