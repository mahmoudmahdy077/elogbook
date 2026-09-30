import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const migrationsDir = resolve(repoRoot, 'supabase/migrations');

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

interface Policy {
  name: string;
  table: string;
  command: string;
  roles: string;
  using: string;
  withCheck: string;
}

function normalizeSql(source: string): string {
  return source.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
}

function unquote(identifier: string): string {
  return identifier.trim().replace(/^"(.*)"$/, '$1');
}

function finalPolicies(table: string): Policy[] {
  const policies = new Map<string, Policy>();

  for (const file of migrationFiles) {
    const sql = normalizeSql(readFileSync(resolve(migrationsDir, file), 'utf8'));

    for (const match of sql.matchAll(/DROP\s+POLICY\s+IF\s+EXISTS\s+("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+(?:public\.)?([A-Za-z0-9_]+)\s*;/gi)) {
      if (match[2].toLowerCase() === table.toLowerCase()) policies.delete(unquote(match[1]));
    }

    const createRe =
      /CREATE\s+POLICY\s+("[^"]+"|[A-Za-z0-9_]+)\s+ON\s+(?:public\.)?([A-Za-z0-9_]+)\s+FOR\s+([A-Za-z]+)(?:\s+TO\s+([A-Za-z0-9_,\s]+?))?(?:\s+USING\s*\(([\s\S]*?)\))?(?:\s+WITH\s+CHECK\s*\(([\s\S]*?)\))?\s*;/gi;
    for (const match of sql.matchAll(createRe)) {
      if (match[2].toLowerCase() !== table.toLowerCase()) continue;
      policies.set(unquote(match[1]), {
        name: unquote(match[1]),
        table: table,
        command: match[3].toUpperCase(),
        roles: (match[4] ?? 'PUBLIC').replace(/\s+/g, '').toUpperCase(),
        using: (match[5] ?? '').replace(/\s+/g, ' ').trim(),
        withCheck: (match[6] ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
  }

  return [...policies.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const casePolicies = finalPolicies('case_entries');
const approvalPolicies = finalPolicies('approval_requests');

const commandMigrationName = '20260926000001_clinical_command_boundary.sql';
const commandMigrationPath = resolve(migrationsDir, commandMigrationName);
const commandMigrationExists = readdirSync(migrationsDir).includes(commandMigrationName);
const commandMigration = commandMigrationExists
  ? readFileSync(commandMigrationPath, 'utf8')
  : '';

const decisionMigrationName = '20260926000004_decide_case_contract.sql';
const decisionMigrationPath = resolve(migrationsDir, decisionMigrationName);
const decisionMigrationExists = readdirSync(migrationsDir).includes(decisionMigrationName);
const decisionMigration = decisionMigrationExists
  ? readFileSync(decisionMigrationPath, 'utf8')
  : '';

// 20260930000001 converges the state the first two files describe: the
// approved-tombstone guard, the privileged pre-approved insert branch and the
// legacy approval RPCs. Assertions about enforcement read the final state, not
// the first file to state the rule.
const repairMigrationName = '20260930000001_clinical_tombstone_insert_and_phi_convergence.sql';
const repairMigrationPath = resolve(migrationsDir, repairMigrationName);
const repairMigrationExists = readdirSync(migrationsDir).includes(repairMigrationName);
const repairMigration = repairMigrationExists ? readFileSync(repairMigrationPath, 'utf8') : '';

// The converged definition of the operation RPC body, whose insert half has to
// state the same insert refusal in its own JSONB vocabulary.
const operationMigrationName = '20260927000001_case_operation_error_contract.sql';
const operationMigrationPath = resolve(migrationsDir, operationMigrationName);
const operationMigrationExists = readdirSync(migrationsDir).includes(operationMigrationName);
const operationMigration = operationMigrationExists ? readFileSync(operationMigrationPath, 'utf8') : '';
const finalCommandMigration = `${commandMigration}\n${decisionMigration}\n${operationMigration}\n${repairMigration}`;

/** The converged definition of a function, from the last file to define it. */
function finalDefinition(name: string): string {
  return functionBodyIn(
    finalCommandMigration,
    name,
    'must be defined in the final migration state',
    finalCommandMigration.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
  );
}

/** Everything from `CREATE OR REPLACE FUNCTION <name>(` at `index` to its end. */
function functionBodyIn(
  sql: string,
  name: string,
  message: string,
  index = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
): string {
  expect(index, `${name} ${message}`).toBeGreaterThan(-1);
  // The terminator is `$$;` or `$$ LANGUAGE plpgsql ...`, never a bare `$$;`
  // search: a plpgsql body closes with the language clause attached, so looking
  // for `$$;` alone runs past the function and reports the next one instead.
  const terminator = /\n\$\$[ \t]*(?:;|LANGUAGE)/g;
  terminator.lastIndex = index;
  const end = terminator.exec(sql)?.index;
  expect(end, `${name} must be terminated`).toBeGreaterThan(index);
  return sql.slice(index, end);
}

function writePolicies(table: 'case_entries' | 'approval_requests') {
  const all = table === 'case_entries' ? casePolicies : approvalPolicies;
  return all.filter((policy) => policy.command === 'UPDATE' || policy.command === 'INSERT' || policy.command === 'ALL');
}

describe('clinical command boundary — final state policy catalog', () => {
  it('replays a non-empty final policy catalog for both clinical tables', () => {
    expect(casePolicies.length).toBeGreaterThan(0);
    expect(approvalPolicies.length).toBeGreaterThan(0);
  });

  it('removes every direct privileged case status transition policy', () => {
    const names = casePolicies.map((policy) => policy.name);
    expect(names).not.toContain('supervisor+ update pending tenant entries');
    expect(names).not.toContain('Supervisor can approve/reject entries in tenant');
  });

  it('removes the direct privileged tenant tombstone policy', () => {
    expect(casePolicies.map((policy) => policy.name)).not.toContain('supervisor+ soft delete tenant entries');
  });

  it('leaves no privileged or soft-delete UPDATE policy on case_entries', () => {
    // Naming the two survivors is the assertion: a policy cannot be widened
    // without a new name, and a new name is what this list rejects. A
    // privileged UPDATE policy, a FOR ALL policy, or a soft-delete policy
    // scoped past `draft` is each a direct path around the command boundary.
    const updatePolicies = casePolicies.filter(
      (policy) => policy.command === 'UPDATE' || policy.command === 'ALL',
    );
    expect(updatePolicies.map((policy) => policy.name).sort()).toEqual([
      'residents edit own draft or rejected entries',
      'residents soft delete own draft entries',
    ]);
    // The same rule as the migration's own catalog assertion, asserted from the
    // source that would otherwise reintroduce one.
    expect(repairMigration).toContain(
      "policy_record.policyname NOT IN (\n        'residents edit own draft or rejected entries',\n        'residents soft delete own draft entries'\n      )",
    );
    expect(repairMigration).toContain('SEC-015: a privileged or soft-delete UPDATE policy remains');
  });

  it('leaves no direct write policy that can reach an approved or pending case status', () => {
    for (const policy of writePolicies('case_entries')) {
      const statusClause = (policy.withCheck.match(/status\s+(?:IN\s*\([^)]*\)|=\s*'[^']*')/i) ?? [''])[0];
      expect({
        policy: policy.name,
        statusClause,
        reachesApproved: /'approved'/.test(statusClause),
        reachesPending: /'pending'/.test(statusClause),
      }).toEqual({
        policy: policy.name,
        statusClause,
        reachesApproved: false,
        reachesPending: false,
      });
    }
  });

  it('leaves no resident write policy that can move a case into pending', () => {
    for (const policy of writePolicies('case_entries')) {
      expect({ policy: policy.name, reachesPending: /'pending'/.test(policy.withCheck) }).toEqual({
        policy: policy.name,
        reachesPending: false,
      });
    }
  });

  it('keeps the resident content edit path without any status transition', () => {
    const editPolicy = casePolicies.find((policy) => policy.name === 'residents edit own draft or rejected entries');
    expect(editPolicy).toBeDefined();
    expect(editPolicy?.command).toBe('UPDATE');
    expect(editPolicy?.using).toContain("status IN ('draft','rejected')");
    expect(editPolicy?.withCheck).toContain("status IN ('draft','rejected')");
    expect(editPolicy?.withCheck).toContain('deleted_at IS NULL');
  });

  it('forbids direct soft deletes of approved clinical records', () => {
    const residentTombstone = casePolicies.find(
      (policy) => policy.name === 'residents soft delete own draft entries',
    );
    expect(residentTombstone).toBeDefined();
    expect(residentTombstone?.using).toContain("status = 'draft'");
    expect(residentTombstone?.using).toContain('deleted_at IS NULL');
  });

  it('removes direct privileged and resident writes on approval_requests', () => {
    const names = approvalPolicies.map((policy) => policy.name);
    expect(names).not.toContain('Supervisor+ update approval requests');
    expect(names).not.toContain('Residents create approval requests');
    expect(approvalPolicies.filter((policy) => policy.command !== 'SELECT')).toEqual([]);
  });

  it('keeps the tenant-scoped approval_requests read policy', () => {
    const readPolicy = approvalPolicies.find((policy) => policy.name === 'Tenant members read approval requests');
    expect(readPolicy?.command).toBe('SELECT');
    expect(readPolicy?.using).toContain('tenant_id = get_tenant_id()');
  });
});

describe('clinical command boundary — command RPC contract', () => {
  it('ships the command boundary, decide-contract and convergence migrations', () => {
    expect(commandMigrationExists).toBe(true);
    expect(decisionMigrationExists).toBe(true);
    expect(repairMigrationExists).toBe(true);
  });

  it('defines the submit and decide command RPCs as SECURITY DEFINER', () => {
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_case_command\(/);
    expect(finalCommandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.decide_case_command\(/);
    expect(commandMigration).toMatch(/SECURITY DEFINER/);
    expect(commandMigration).toMatch(/SET search_path = (?:''|pg_catalog, public, pg_temp)/);
  });

  it('gates the decide command on live AAL2 and returns stable denials', () => {
    expect(finalCommandMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.decide_case_command\([\s\S]*?v_principal\.aal IS DISTINCT FROM 'aal2'/,
    );
    expect(finalCommandMigration).toMatch(/get_authoritative_principal_with_aal/);
    expect(finalCommandMigration).toMatch(/'code', 'account_inactive'/);
    expect(finalCommandMigration).toMatch(/'code', 'tenant_suspended'/);
  });

  it('scopes the command grants to authenticated and denies PUBLIC and anon', () => {
    expect(finalCommandMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.decide_case_command\([^)]*\) FROM PUBLIC, anon/,
    );
    expect(finalCommandMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.decide_case_command\([^)]*\) TO authenticated/,
    );
    expect(commandMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.submit_case_command\([^)]*\) TO authenticated/,
    );
  });

  it('records an idempotency ledger scoped by tenant, actor, command and request id', () => {
    expect(commandMigration).toContain('clinical_command_log');
    expect(commandMigration).toMatch(/idempotency_conflict/);
    expect(commandMigration).toMatch(/UNIQUE[\s\S]*tenant_id[\s\S]*actor_profile_id[\s\S]*command[\s\S]*request_id/);
  });

  it('fails closed when the tenant has no eligible reviewer', () => {
    expect(commandMigration).toMatch(/no_eligible_reviewer/);
  });

  it('writes status, audit and outbox rows in the same transaction', () => {
    expect(commandMigration).toMatch(/INSERT INTO public\.audit_outbox/);
    expect(commandMigration).toMatch(/INSERT INTO public\.audit_logs/);
  });

  it('enforces AAL2 or command context inside the status transition guard', () => {
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.clinical_transition_authorized\(/);
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_case_status_transition\(/);
    expect(commandMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_case_status_transition\([\s\S]*?clinical_transition_authorized\(/,
    );
  });

  it('blocks direct soft deletes of approved clinical records in the write-once guard', () => {
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.write_once_submitted_check\(/);
    // The final definition, not the first one to state the rule. 20260926000001
    // keyed the guard on `current_user = 'authenticated'` inside a SECURITY
    // DEFINER function, where current_user is the function owner and the
    // comparison is never true -- so the guard fired on no path at all.
    const guard = finalDefinition('write_once_submitted_check');
    expect(guard).toMatch(/OLD\.status = 'approved' AND auth\.uid\(\) IS NOT NULL/);
    expect(guard).toMatch(/insufficient_privilege/);
    expect(guard).not.toMatch(/current_user/);
    // The resident and privileged tombstone paths both go through the same
    // UPDATE, so one reachable check covers submit_case_operation and
    // soft_delete_case alike.
    expect(guard).toMatch(/Soft-delete must not alter case content/);
  });

  it('keeps the approved tombstone refusal attributable in soft_delete_case', () => {
    // soft_delete_case returns JSONB rather than raising, so the trigger alone
    // would surface as an exception from a function whose contract is a result.
    const softDelete = finalDefinition('soft_delete_case');
    expect(softDelete).toMatch(/IF v_status = 'approved' THEN/);
    expect(softDelete).toMatch(/insufficient_privilege/);
    // The AAL2 gate is unchanged, and it stays on the privileged branch: a
    // privileged principal is removing someone else's clinical record, so the
    // ownership check below it is the resident's alone. Applying it to both
    // would refuse every privileged tombstone, because the caller is by
    // definition not the resident.
    expect(softDelete).toMatch(
      /IF v_principal\.role <> 'resident' THEN[\s\S]*?require_privileged_principal\(\s*ARRAY\['supervisor', 'director', 'institution_admin', 'admin'\]::TEXT\[\],\s*v_principal\.tenant_id,\s*TRUE\s*\)[\s\S]*?END IF;\s+ELSE\s+SELECT entry\.resident_id[\s\S]*?v_resident_id IS DISTINCT FROM v_principal\.profile_id[\s\S]*?END IF;/,
    );
    expect(repairMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.soft_delete_case\(UUID\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(repairMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.soft_delete_case\(UUID\) TO authenticated;/,
    );
  });

  it('refuses an authenticated non-draft insert instead of rewriting it to a draft', () => {
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_case_insert_status\(/);
    // The branch that let a supervisor at AAL2 INSERT a case already
    // `approved` -- an approval with no approval request and therefore no
    // ledger -- is removed rather than tightened.
    const guard = finalDefinition('enforce_case_insert_status');
    expect(guard).not.toMatch(/clinical_transition_authorized/);
    expect(guard).not.toMatch(/'approved'/);
    // The silent rewrite is gone too. Coercing `pending` to `draft` returned
    // 201/200 and let a caller believe it had queued a case for review, so the
    // refusal is now stable, attributable and leaves no row behind.
    expect(guard).not.toMatch(/NEW\.status\s*:=\s*'draft'/);
    expect(guard).toMatch(
      /IF NEW\.status IS DISTINCT FROM 'draft' THEN[\s\S]*?RAISE EXCEPTION 'case_insert_status_not_permitted'[\s\S]*?ERRCODE = 'insufficient_privilege'/,
    );
    // The two documented exemptions survive: the individual auto-approval path
    // and an unauthenticated maintenance principal.
    expect(guard).toMatch(/tenant_type = 'individual'/);
    expect(guard).toMatch(/IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  });

  it('states the same insert refusal in the operation RPC vocabulary', () => {
    // The trigger is the chokepoint, but submit_case_operation returns JSONB
    // rather than raising, so a refusal that reached it as an exception would
    // be reported as `internal_error` and the resident would be told to retry
    // a request that can never succeed. The body states the refusal in the
    // closed vocabulary, exactly as it already does for the update half.
    const body = functionBodyIn(
      finalCommandMigration,
      '__a2_submit_case_operation',
      'must define the operation body',
    );
    expect(body).toMatch(
      /p_action = 'insert' THEN[\s\S]*?p_payload \? 'status'[\s\S]*?'policy: command_boundary'[\s\S]*?'code', 'state_conflict'[\s\S]*?EXIT work;/,
    );
  });

  it('resolves the approval request inside the caller tenant, not by entry id alone', () => {
    // The case lookup above it is tenant-pinned, so an entry_id-only lookup on
    // approval_requests looks covered and is not: the request is a second table
    // with its own tenant column, and SECURITY DEFINER means nothing re-checks
    // it. A request row whose tenant disagrees with the entry it points at would
    // be resolved and written by a principal of a different tenant.
    //
    // Both the file that first states the rule and the definition that
    // supersedes it have to carry the predicate, or the earlier one reads as the
    // boundary it is not.
    for (const [label, body] of [
      ['20260926000001', functionBodyIn(commandMigration, 'decide_case_command', 'must define the decide command')],
      ['final', finalDefinition('decide_case_command')],
    ] as const) {
      const lookup = body.slice(
        body.indexOf('FROM public.approval_requests'),
        body.indexOf('LIMIT 1', body.indexOf('FROM public.approval_requests')),
      );
      expect(lookup, `${label} must read the approval request`).toContain('FROM public.approval_requests');
      expect(lookup, `${label} must match the principal tenant on the approval read`).toContain(
        'tenant_id = v_principal.tenant_id',
      );
    }
  });
});
