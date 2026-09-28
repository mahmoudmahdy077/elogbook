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
const finalCommandMigration = `${commandMigration}\n${decisionMigration}`;

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
  it('ships the command boundary and decide-contract migrations', () => {
    expect(commandMigrationExists).toBe(true);
    expect(decisionMigrationExists).toBe(true);
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
    expect(commandMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.write_once_submitted_check\([\s\S]*?approved/,
    );
  });

  it('requires AAL2 for privileged pre-approved case inserts', () => {
    expect(commandMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_case_insert_status\(/);
    expect(commandMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_case_insert_status\([\s\S]*?clinical_transition_authorized\(/,
    );
  });
});
