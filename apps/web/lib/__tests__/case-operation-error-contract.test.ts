import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The mobile case-operation RPC used to return `'db: ' || LEFT(SQLERRM, 300)`
// to the client. Raw database text is not a contract: it discloses schema and
// plan state, and clients were pattern-matching its English to decide whether
// to retry. These assertions are structural -- they read the migration that
// defines the final state of the function, so a later edit that reintroduces a
// server-text result fails here rather than in production.

const repoRoot = resolve(process.cwd(), '..', '..');
const migration = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260927000001_case_operation_error_contract.sql'),
  'utf8',
);

/**
 * The function that carries the contract.
 *
 * The public name is the AAL2 wrapper (asserted in
 * case-operation-aal2-command-boundary.static.test.ts); the body that resolves
 * failures is __a2_submit_case_operation, which only the wrapper can reach.
 */
const CONTRACT_FUNCTION = 'CREATE OR REPLACE FUNCTION public.__a2_submit_case_operation(';

/** The contract body, from its definition to the closing of the SQL block. */
function submitCaseOperationBody(): string {
  const start = migration.indexOf(CONTRACT_FUNCTION);
  expect(start).toBeGreaterThan(-1);
  const end = migration.indexOf('COMMENT ON FUNCTION public.__a2_submit_case_operation', start);
  return migration.slice(start, end === -1 ? undefined : end);
}

describe('case operation error contract', () => {
  it('never puts server text into a result', () => {
    const body = submitCaseOperationBody();
    // SQLERRM may be READ (to pick a code) but must never be concatenated into
    // a value the function returns.
    expect(body).not.toMatch(/'db: '/);
    expect(body).not.toMatch(/SQLERRM\s*\|\|/);
    expect(body).not.toMatch(/\|\|\s*SQLERRM/);
    expect(body).toMatch(/case_operation_error_code\(SQLSTATE, SQLERRM\)/);
  });

  it('returns a code and a fixed phrase for every failure exit', () => {
    const body = submitCaseOperationBody();
    const failureObjects = body.match(/'success', false[\s\S]{0,320}?\);/g) ?? [];
    expect(failureObjects.length).toBeGreaterThan(0);
    for (const object of failureObjects) {
      // A literal code, or the mapped code the exception handler resolved. Both
      // are values from the closed vocabulary; neither is server text.
      expect(object).toMatch(/'code', ('[a-z:_ ]+'|v_error_code)/);
      expect(object).toMatch(/'error', ('[^']*'|public\.case_operation_error_text\(v_error_code\))/);
    }
  });

  it('maps server text onto a closed vocabulary through a helper', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.case_operation_error_code(');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.case_operation_error_text(');
    // An unmapped state is admitted as unknown rather than guessed at.
    expect(migration).toMatch(/ELSE\s+RETURN\s+'internal_error'/);
  });

  it('keeps the helpers out of reach of client roles', () => {
    // The code-to-phrase mapping is internal: a client has no business reading
    // the vocabulary, and exposing the SQLSTATE mapper would invite treating it
    // as a supported API.
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.case_operation_error_code(TEXT, TEXT) FROM PUBLIC, anon;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.case_operation_error_text(TEXT) FROM PUBLIC, anon;',
    );
    // The body has to be unreachable directly, or the AAL2 wrapper around it is
    // an obstacle a client can walk past.
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.__a2_submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated;',
    );
  });

  it('logs the detail server-side so an operator can still diagnose it', () => {
    expect(submitCaseOperationBody()).toMatch(/RAISE WARNING/);
  });
});

describe('error vocabulary reachability', () => {
  it('gives every code the mapper can emit a fixed phrase', () => {
    const emitted = [...migration.matchAll(/RETURN '([a-z:_ ]+)';/g)].map((match) => match[1] as string);
    const mapped = new Set(emitted);
    for (const code of mapped) {
      expect(migration).toMatch(new RegExp(`\\('${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',`));
    }
    expect(mapped.size).toBeGreaterThan(5);
  });
});
