import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * approve_case / reject_case are not an alternate approval path.
 *
 * decide_case_command is the only route out of `pending`, because it resolves
 * one locked pending approval request in the same transaction as the status
 * change and writes the idempotency ledger, the audit row and the outbox row
 * with it. The two legacy RPCs did none of that: they wrote the status and the
 * approval request directly, matched no tenant on the request, and carried no
 * idempotency key, so a retried tap could approve twice and a decision could
 * land on another tenant's queue.
 *
 * The migration revokes their client grant, which is only meaningful if nothing
 * is still calling them -- and a mobile client calling `supabase.rpc(...)` is
 * exactly the "client" that grant served. So this suite asserts both halves:
 * the database says the door is closed, and no repository route reaches for it.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

const REPAIR_MIGRATION =
  'supabase/migrations/20260930000001_clinical_tombstone_insert_and_phi_convergence.sql';
const COMMAND_MIGRATION = 'supabase/migrations/20260926000001_clinical_command_boundary.sql';
const P1_26 = 'supabase/tests/p1_26_privileged_aal2.sql';
const P1_32 = 'supabase/tests/p1_32_clinical_command_boundary.sql';

/** Where a production call could hide. Documentation and fixtures are excluded. */
const SOURCE_ROOTS = [
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/mobile/app',
  'apps/mobile/lib',
  'packages',
  'supabase/functions',
];

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function sourceFiles(root: string): string[] {
  const absolute = resolve(repoRoot, root);
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absoluteEntry = join(directory, entry);
      if (statSync(absoluteEntry).isDirectory()) {
        if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
        walk(absoluteEntry);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|jsx)$/.test(entry)) continue;
      // A fixture that names the retired RPC is asserting the closure; a
      // production call is not.
      if (/\.(test|spec)\.[a-z]+$/.test(entry)) continue;
      if (relative(repoRoot, absoluteEntry).split('\\').join('/').includes('__tests__/')) continue;
      found.push(relative(repoRoot, absoluteEntry).split('\\').join('/'));
    }
  };
  walk(absolute);
  return found;
}

/**
 * Every production source file, read once.
 *
 * Collected at module scope rather than inside a test: walking seven source
 * trees costs several seconds on Windows, and a per-test timeout would make the
 * guard flaky rather than wrong.
 */
const productionSources = SOURCE_ROOTS.flatMap(sourceFiles).map((file) => ({
  file,
  source: readFileSync(resolve(repoRoot, file), 'utf8'),
}));

describe('the legacy approval RPCs hold no client grant', () => {
  const repair = read(REPAIR_MIGRATION);

  it('revokes approve_case and reject_case from every client role', () => {
    for (const signature of ['public.approve_case(UUID, UUID, TEXT)', 'public.reject_case(UUID, UUID, TEXT)']) {
      expect(repair, `${signature} must be revoked from every client role`).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`,
      );
    }
  });

  it('does not re-grant them later in the same file', () => {
    // A GRANT anywhere after the revoke, or in a later migration, reopens the
    // door; the whole point of revoking is that the grant is not the boundary.
    const grant = /GRANT[^;]*\b(approve_case|reject_case)\b/;
    expect(grant.test(repair)).toBe(false);
  });

  it('keeps them present but unreachable, so the ACL can still be read', () => {
    // Dropping them would make p1_26's has_function_privilege('anon', ...) raise
    // "function does not exist" instead of answering, which is a worse signal
    // than a privilege answer. The functions stay, revoked and ungranted.
    expect(repair).toContain('COMMENT ON FUNCTION public.approve_case(UUID, UUID, TEXT) IS');
    expect(repair).toContain('COMMENT ON FUNCTION public.reject_case(UUID, UUID, TEXT) IS');
    expect(repair).not.toMatch(/DROP FUNCTION[^;]*\b(approve_case|reject_case)\b/);
  });

  it('asserts the closure from the catalog rather than asserting it in a comment', () => {
    expect(repair).toContain(
      "has_function_privilege('authenticated', 'public.approve_case(uuid,uuid,text)', 'EXECUTE')",
    );
    expect(repair).toContain(
      "has_function_privilege('authenticated', 'public.reject_case(uuid,uuid,text)', 'EXECUTE')",
    );
    expect(repair).toContain('SEC-014: approve_case/reject_case are still client-reachable');
  });
});

describe('no production surface still calls the legacy RPCs', () => {
  it('finds no rpc call to approve_case or reject_case in application code', () => {
    const callers: string[] = [];
    for (const { file, source } of productionSources) {
      if (/\.rpc\(\s*['"`](approve_case|reject_case)['"`]/.test(source)) callers.push(file);
      if (/\b(approve_case|reject_case)\s*\(/.test(source) && !/public\.(approve_case|reject_case)/.test(source)) {
        callers.push(file);
      }
    }
    expect(callers).toEqual([]);
  });

  it('actually walked the application source, so the assertion above is not vacuous', () => {
    // A parser that matched nothing would make the check above pass for the
    // wrong reason. The mobile adapter and the web approval route are both
    // known to be in the set.
    const files = productionSources.map((entry) => entry.file);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('apps/mobile/lib/operations.ts');
    expect(files).toContain('apps/web/app/api/[tenant]/approvals/action/route.ts');
  });

  it('routes the mobile adapter and both mobile screens through the command', () => {
    const operations = read('apps/mobile/lib/operations.ts');
    expect(operations).toContain("deps.rpc('decide_case_command'");
    expect(operations).toContain('p_case_id: deps.entryId');
    expect(operations).toContain('p_request_id: requestId()');
    expect(operations).toContain('p_decision: deps.action');
    for (const screen of ['apps/mobile/app/(tabs)/case-detail.tsx', 'apps/mobile/app/(tabs)/approvals.tsx']) {
      expect(read(screen), `${screen} must cast the command, not the retired RPCs`).toContain(
        "as 'decide_case_command'",
      );
    }
  });

  it('names the step-up action after the command, not the retired RPC', () => {
    // The client gate is fail-fast only, but a gate keyed on a retired RPC name
    // reads as though that RPC is still the boundary.
    expect(read('apps/mobile/lib/capability.ts')).toContain("'decide_case'");
    expect(read('apps/mobile/lib/authorization.ts')).toContain("requiresStepUp(cap, 'decide_case')");
    for (const file of ['apps/mobile/lib/capability.ts', 'apps/mobile/lib/authorization.ts']) {
      expect(read(file), `${file} must not gate on the retired RPC name`).not.toContain("'approve_case'");
    }
  });

  it('leaves the web approval route on the command', () => {
    const route = read('apps/web/app/api/[tenant]/approvals/action/route.ts');
    expect(route).toContain("supabase.rpc('decide_case_command'");
    expect(route).not.toContain("'approve_case'");
    expect(route).not.toContain("'reject_case'");
  });
});

describe('the published API contract matches the closure', () => {
  it('does not advertise a grant the database no longer holds', () => {
    // A published contract that still says `grant: authenticated` for a
    // revoked RPC is a documentation bug that reads as a live endpoint, and
    // every future client is written against it.
    for (const spec of ['docs/openapi.yaml', 'apps/web/public/openapi.yaml']) {
      const source = read(spec);
      for (const name of ['approve_case', 'reject_case']) {
        const entry = source.slice(source.indexOf(`- name: ${name}\n`));
        const grant = entry.slice(0, entry.indexOf('\n\n')).match(/\n {4}grant: (\S+)/);
        expect(grant, `${spec}: ${name} must state its grant`).not.toBeNull();
        expect(grant?.[1], `${spec}: ${name} must not be advertised as callable`).toBe('none');
        expect(entry.slice(0, entry.indexOf('\n\n'))).toContain('deprecated: true');
      }
      // The replacement is published, so a client author finds the live path.
      expect(source).toContain('- name: decide_case_command');
    }
  });
});

describe('the database suite states the closure as a live assertion', () => {  it('p1_26 no longer treats a live approve_case at AAL2 as the happy path', () => {
    const suite = read(P1_26);
    expect(suite).toContain(
      "has_function_privilege('authenticated', 'public.approve_case(uuid,uuid,text)', 'EXECUTE')",
    );
    expect(suite).toContain(
      "has_function_privilege('authenticated', 'public.reject_case(uuid,uuid,text)', 'EXECUTE')",
    );
    // The wrapper history still explains the AAL2 boundary, and the command
    // boundary is the live one.
    expect(suite).not.toMatch(/lives_ok\(\s*\$\$SELECT public\.approve_case/);
  });

  it('p1_32 proves the tombstone, insert, policy and grant closures', () => {
    const suite = read(P1_32);
    expect(suite).toContain('a resident cannot tombstone an approved record through the operation RPC');
    expect(suite).toContain('an AAL2 privileged principal cannot tombstone an approved clinical record');
    expect(suite).toContain('the operation RPC refuses a caller-supplied approval instead of coercing it');
    expect(suite).toContain('the refused insert persisted nothing');
    expect(suite).toContain('a direct INSERT naming pending is refused rather than rewritten to draft');
    expect(suite).toContain('an individual tenant keeps its documented server-side auto-approval on insert');
    expect(suite).toContain('no privileged or soft-delete UPDATE policy remains on case_entries');
    expect(suite).toContain('authenticated cannot execute the retired approve_case RPC');
  });

  it('the command boundary migration still defines the live approval path', () => {
    // The closure is a removal, not a deletion: decide_case_command is the
    // replacement and it has to exist.
    const boundary = read(COMMAND_MIGRATION);
    expect(boundary).toContain('CREATE OR REPLACE FUNCTION public.decide_case_command(');
    expect(boundary).toContain('GRANT EXECUTE ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) TO authenticated;');
  });
});
