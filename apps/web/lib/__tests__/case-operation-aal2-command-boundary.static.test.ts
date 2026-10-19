import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for the AAL2 boundary on `submit_case_operation`.
 *
 * 20260927000001 replaced the AAL2 wrapper that 20260923000011 had put around
 * the RPC with the raw `__a2_submit_case_operation` body. That removed the only
 * AAL2 check on the mobile write path: the RPC is SECURITY DEFINER, so an AAL1
 * supervisor session could update and soft-delete another resident's clinical
 * record, and any caller could push a case toward the approval queue without
 * the approval request that the command boundary exists to create.
 *
 * The live proofs are pgTAP (p1_26, p3_03), which need a database. This suite
 * needs only the repository, so it fails wherever the code is written when a
 * later edit folds the wrapper back into the body -- which is a silent,
 * passing change for every test that only reads the error contract.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

const OPERATION_MIGRATION =
  'supabase/migrations/20260927000001_case_operation_error_contract.sql';
const AAL2_MIGRATION = 'supabase/migrations/20260923000011_privileged_aal2.sql';
const COMMAND_BOUNDARY_MIGRATION =
  'supabase/migrations/20260926000001_clinical_command_boundary.sql';
const P3_03 = 'supabase/tests/p3_03_case_operation_rpc.sql';
const P1_18 = 'supabase/tests/p1_18_principal_status_rls.sql';

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** Everything from `signature` to the `$$;` that closes its body. */
function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} must exist in ${OPERATION_MIGRATION}`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${signature} must be terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/**
 * A function body with its comments removed and its whitespace collapsed.
 *
 * A comment that NAMES the construct it exists to forbid must not read as a use
 * of it, and an assertion about the ORDER of two checks must not be an assertion
 * about how the statement was wrapped across lines.
 */
function code(sql: string, signature: string): string {
  return functionBody(sql, signature)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * The SQL top-level pgTAP assertions a suite contains. Mirrors the counter
 * scripts/verify-security-tests.mjs and scripts/verify-test-inventory.mjs use,
 * so a suite cannot quietly stop matching its own plan.
 */
function pgTapAssertions(sql: string): number {
  return [
    ...sql.matchAll(
      /^[ \t]*SELECT[ \t]+(?:isnt_empty|is_empty|isnt|is|ok|throws_ok|lives_ok|like|has_table|has_column|has_function|matches|alike|unlike|set_eq|set_ne|bag_eq|results_eq|results_ne)[ \t]*\(/gim,
    ),
  ].length;
}

function pgTapPlan(sql: string): number {
  return Number(sql.match(/^[ \t]*SELECT[ \t]+plan[ \t]*\([ \t]*(\d+)[ \t]*\)/im)?.[1] ?? 0);
}

const migration = read(OPERATION_MIGRATION);
const wrapper = code(migration, 'CREATE OR REPLACE FUNCTION public.submit_case_operation(');
const contract = code(migration, 'CREATE OR REPLACE FUNCTION public.__a2_submit_case_operation(');

describe('submit_case_operation is the authoritative AAL2 entry point again', () => {
  it('is a wrapper that delegates, not the raw body', () => {
    // The wrapper must do the authority work and nothing else. If it also holds
    // the body, the AAL2 check is one `RETURN` away from being dropped again.
    expect(wrapper).toMatch(
      /RETURN public\.__a2_submit_case_operation\(p_op_id, p_action, p_row_id, p_payload\);/,
    );
    expect(wrapper).not.toMatch(/INSERT INTO/i);
    expect(wrapper).not.toMatch(/UPDATE\s+public\./i);
    expect(wrapper).not.toMatch(/DELETE\s+FROM/i);
    expect(wrapper).toMatch(/LANGUAGE plpgsql/);
    expect(wrapper).toMatch(/SECURITY DEFINER/);
    expect(wrapper).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
  });

  it('resolves the principal through the AAL-aware helper', () => {
    expect(wrapper).toMatch(/FROM public\.get_authoritative_principal_with_aal\(\)/);
    // The non-AAL helper cannot answer the only question that matters here.
    expect(wrapper).not.toMatch(/get_authoritative_principal\(\)/);
  });

  it('requires a live AAL2 claim for a privileged role', () => {
    // The third argument is p_require_aal2 and it must be TRUE: the wrapper's
    // whole job is that a role label is not enough.
    expect(wrapper).toMatch(
      /require_privileged_principal\(\s*ARRAY\['supervisor', 'director', 'institution_admin', 'admin'\]::TEXT\[\],\s*v_principal\.tenant_id,\s*TRUE\s*\)/,
    );
    expect(wrapper).toMatch(/v_principal\.role <> 'resident'/);
    // A role outside the known set is refused before anything else is read.
    expect(wrapper).toMatch(
      /v_principal\.role NOT IN \('resident', 'supervisor', 'director', 'institution_admin', 'admin'\)/,
    );
  });

  it('refuses a session with no aal claim at all', () => {
    // The helper reads `aal` from the JWT and returns NULL for anything that is
    // not aal1/aal2, so a claim that never carried one cannot satisfy the check.
    expect(wrapper).toMatch(/v_principal\.aal NOT IN \('aal1', 'aal2'\)/);
    expect(wrapper).toMatch(/v_principal\.aal/);
  });

  it('keeps a resident on the owner path', () => {
    // The resident branch is the ELSE of the privileged one, so the AAL2 gate
    // above it cannot be skipped by falling through: a resident is checked for
    // an assurance level and for ownership instead.
    expect(wrapper).toMatch(
      /IF v_principal\.role <> 'resident' THEN[\s\S]*? ELSE IF v_principal\.aal NOT IN \('aal1', 'aal2'\) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF; IF p_row_id IS NOT NULL THEN/,
    );
    expect(wrapper).toMatch(/entry\.tenant_id = v_principal\.tenant_id/);
    expect(wrapper).toMatch(/v_target_resident_id IS DISTINCT FROM v_principal\.profile_id/);
  });

  it('refuses with a closed error rather than a diagnostic', () => {
    const raises = wrapper.match(/RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(2);
    // The boundary raises; it never narrates. No server text, no SQLSTATE, no
    // SQLERRM anywhere on the client path.
    expect(wrapper).not.toMatch(/SQLERRM/);
    expect(wrapper).not.toMatch(/SQLSTATE/);
    expect(wrapper).not.toMatch(/'db: '/);
  });

  it('leaves the delegated body unreachable from any client role', () => {
    // Without this, `authenticated` could call the body directly and step over
    // the wrapper entirely.
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.__a2_submit_case_operation\(TEXT, TEXT, UUID, JSONB\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*__a2_submit_case_operation/);
  });

  it('keeps the client grants where the 20260923000011 AAL2 migration put them', () => {
    // CREATE OR REPLACE resets a replaced function to the default PUBLIC execute
    // grant, so the revoke has to be re-asserted here or service_role inherits
    // it. p1_26 and p1_17 both read this function's ACL.
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.submit_case_operation\(TEXT, TEXT, UUID, JSONB\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.submit_case_operation\(TEXT, TEXT, UUID, JSONB\) TO authenticated;/,
    );
    const aal2 = read(AAL2_MIGRATION);
    expect(aal2).toMatch(
      /REVOKE ALL ON FUNCTION public\.submit_case_operation\(TEXT, TEXT, UUID, JSONB\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });
});

describe('the delegated body keeps the stable error contract', () => {
  it('still resolves failures through the closed vocabulary', () => {
    expect(contract).toMatch(/case_operation_error_code\(SQLSTATE, SQLERRM\)/);
    expect(contract).toMatch(/public\.case_operation_error_text\(v_error_code\)/);
    expect(contract).not.toMatch(/'db: '/);
    expect(contract).not.toMatch(/SQLERRM\s*\|\|/);
    expect(contract).toMatch(/RAISE WARNING/);
  });
});

describe('the operation RPC is not a second door around the command boundary', () => {
  it('refuses a status change that crosses the command line, for every caller', () => {
    // submit_case_command is the only path into `pending` and decide_case_command
    // the only path out of it, because each writes the approval ledger in the
    // same transaction. This RPC writes neither, so a caller-supplied status
    // that would cross that line is refused whatever their role is.
    expect(contract).toMatch(/p_payload \? 'status'/);
    expect(contract).toMatch(/'policy: command_boundary'/);
    expect(contract).toMatch(/'code', 'state_conflict'/);
    // The refusal names the commands that do own the transition, so the reason is
    // recorded where a reader of the migration will find it.
    const raw = functionBody(migration, 'CREATE OR REPLACE FUNCTION public.__a2_submit_case_operation(');
    expect(raw).toMatch(/submit_case_command/);
    expect(raw).toMatch(/decide_case_command/);

    // Ordering is the guarantee: the refusal has to be reached before the
    // ownership/role checks, or a privileged caller reaches the UPDATE first.
    const guard = contract.indexOf("'policy: command_boundary'");
    const ownership = contract.indexOf('v_row.resident_id <> v_profile_id');
    const update = contract.indexOf('UPDATE public.case_entries');
    expect(guard, 'the command-boundary refusal must be emitted').toBeGreaterThan(-1);
    expect(ownership, 'the ownership check must still exist').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ownership);
    expect(guard).toBeLessThan(update);
  });

  it('refuses a privileged tombstone outside soft_delete_case', () => {
    // A privileged actor removing a clinical record is soft_delete_case's job --
    // the AAL2-attributable command. A general-purpose write RPC is not a
    // second door to it.
    expect(contract).toMatch(
      /ELSIF v_row\.resident_id <> v_profile_id\s+THEN\s+v_result := jsonb_build_object\(\s*'success', false,\s*'error', 'policy: use_soft_delete_case',\s*'code', 'forbidden'\s*\);/,
    );
    // The owner's own row is still the resident path, so a resident keeps the
    // tombstone they have always had.
    expect(contract).toMatch(/ELSE\s+UPDATE public\.case_entries\s+SET deleted_at = now\(\)/);
  });

  it('keeps an approved record locked against the resident who owns it', () => {
    // Unchanged behaviour, asserted so the command-boundary work cannot quietly
    // relax it: a resident may not rewrite an approved record through this RPC.
    expect(contract).toMatch(/'policy: approved_locked'/);
    expect(contract).toMatch(/v_row\.status = 'approved'/);
  });

  it('only ever reaches the approval queue through submit_case_command', () => {
    // The command is what creates the approval requests; assert it still exists
    // and is the documented path, so the refusal above names a real alternative.
    const boundary = read(COMMAND_BOUNDARY_MIGRATION);
    expect(boundary).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_case_command\(/);
    expect(boundary).toMatch(/CREATE OR REPLACE FUNCTION public\.decide_case_command\(/);
    expect(boundary).toMatch(/SET status = 'pending'/);
  });
});

describe('p3_03 states the boundary it is supposed to be proving', () => {
  const p303 = read(P3_03);

  it('gives every caller of the RPC a resolvable aal claim', () => {
    // get_authoritative_principal_with_aal returns NULL for a claim with no
    // `aal`, and the wrapper refuses that. A fixture that omits it would be
    // asserting the refusal rather than the behaviour it is named for. The one
    // exception is the probe that exists to prove the refusal, and it has to say
    // so in its own assertion label.
    const segments = p303.split('SET LOCAL request.jwt.claims');
    expect(segments.length).toBeGreaterThan(1);
    let deliberate = 0;
    for (const [index, segment] of segments.entries()) {
      if (index === 0) continue;
      if (!segment.includes('submit_case_operation')) continue;
      const newline = segment.search(/\n/);
      const claims = segment.slice(0, newline === -1 ? undefined : newline);
      const rest = newline === -1 ? '' : segment.slice(newline);
      if (/"aal":"aal[12]"/.test(claims)) continue;
      deliberate += 1;
      expect(
        rest,
        `p3_03 claim block ${index} calls the RPC without an aal claim and does not say it is proving the denial`,
      ).toContain('no aal claim');
    }
    // Exactly one such block, and it is the missing-claim probe.
    expect(deliberate).toBe(1);
  });

  it('proves the AAL2 boundary, the AAL2 path and the missing-claim denial', () => {
    for (const behaviour of [
      'AAL1 supervisor cannot edit',
      'AAL2 supervisor can edit',
      'no aal claim',
      'cannot move a draft case into pending',
      'tombstone is refused outside soft_delete_case',
    ]) {
      expect(p303, `${behaviour} must be asserted`).toContain(behaviour);
    }
    // The denials are exceptions from the wrapper, not a returned code: a test
    // that reads `->> 'error'` on a raising call would not survive the restore.
    expect(p303).toMatch(/throws_ok\(\s*\$\$SELECT public\.submit_case_operation\([\s\S]*?'42501'/);
  });

  it('still plans exactly the assertions it contains', () => {
    expect(pgTapPlan(p303)).toBeGreaterThan(0);
    expect(pgTapAssertions(p303)).toBe(pgTapPlan(p303));
  });
});

describe('p1_18 keeps the suspension contract the wrapper must not swallow', () => {
  const p118 = read(P1_18);

  it('gives the suspended-account and suspended-tenant callers a resolvable claim', () => {
    // The wrapper refuses a principal with no `aal` by raising. These two
    // assertions read `->> 'error'`, so a claim without one would turn them
    // into a raise and abort the suite rather than assert the stable code.
    const segments = p118.split('SET LOCAL request.jwt.claims');
    for (const [index, segment] of segments.entries()) {
      if (index === 0) continue;
      if (!segment.includes('submit_case_operation')) continue;
      expect(
        segment.slice(0, segment.search(/\n\s*SELECT/)),
        `p1_18 claim block ${index} calls the RPC without an aal claim`,
      ).toMatch(/"aal":"aal[12]"/);
    }
  });

  it('still asserts the account and tenant suspension codes', () => {
    expect(p118).toContain("IN ('policy: account_suspended', 'account_suspended')");
    expect(p118).toContain("IN ('policy: tenant_suspended', 'tenant_suspended')");
  });

  it('still plans exactly the assertions it contains', () => {
    expect(pgTapPlan(p118)).toBeGreaterThan(0);
    expect(pgTapAssertions(p118)).toBe(pgTapPlan(p118));
  });
});
