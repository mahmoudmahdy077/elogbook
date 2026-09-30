import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const migrationsDir = resolve(repoRoot, 'supabase', 'migrations');

const consentMigration = readFileSync(
  resolve(migrationsDir, '20260926000005_consent_tenant_authority.sql'),
  'utf8',
);
const consentRow = readFileSync(
  resolve(repoRoot, 'apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx'),
  'utf8',
);
const consentPage = readFileSync(
  resolve(repoRoot, 'apps/web/app/(authenticated)/[tenant]/consent/page.tsx'),
  'utf8',
);

/**
 * The last CREATE POLICY that lands on consent_records for INSERT is the
 * converged state: later migrations supersede earlier ones, exactly as
 * PostgreSQL applies them.
 */
function lastInsertPolicy(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let policy = '';
  for (const file of files) {
    const source = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of source.matchAll(
      /CREATE\s+POLICY[\s\S]*?ON\s+(?:public\.)?consent_records\s+FOR\s+INSERT[\s\S]*?;/gi,
    )) {
      policy = match[0];
    }
  }
  return policy;
}

describe('consent_records tenant authority', () => {
  it('binds the INSERT policy tenant_id to the caller authoritative tenant', () => {
    const policy = lastInsertPolicy();

    expect(policy).not.toBe('');
    // user_id = auth.uid() alone let any resident forge a consent row in a
    // tenant they do not belong to. The tenant must come from the caller's own
    // profile, never from the request payload.
    expect(policy).toMatch(/auth\.uid\(\)/i);
    expect(policy).toMatch(/tenant_id/i);
    expect(policy).toMatch(/FROM\s+(?:public\.)?profiles/i);
    expect(policy).toMatch(/p\.user_id\s*=\s*auth\.uid\(\)/i);
  });

  it('drops the legacy self-insert policy that carried no tenant predicate', () => {
    expect(consentMigration).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Users can insert own consent records"\s+ON\s+(?:public\.)?consent_records/i,
    );
  });

  it('removes direct INSERT from anon and authenticated so the consent RPC is the only path', () => {
    expect(consentMigration).toMatch(
      /REVOKE\s+INSERT[^;]*ON\s+(?:public\.)?consent_records\s+FROM\s+(?:PUBLIC\s*,\s*)?anon\s*,\s*authenticated/i,
    );
  });

  it('keeps the read model available to authenticated users', () => {
    expect(consentMigration).toMatch(
      /GRANT\s+SELECT[^;]*ON\s+(?:public\.)?consent_records\s+TO\s+authenticated/i,
    );
  });

  it('keeps set_user_consent as the SECURITY DEFINER command and locks it to authenticated', () => {
    expect(consentMigration).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.set_user_consent/i);
    expect(consentMigration).toMatch(/SECURITY\s+DEFINER/i);
    expect(consentMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_user_consent\([^)]*\)\s+TO\s+authenticated/i,
    );
    expect(consentMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.set_user_consent\([^)]*\)\s+FROM\s+PUBLIC,\s*anon\s*,\s*service_role/i,
    );
  });

  it('rejects a consent type outside the approved enum inside the RPC', () => {
    expect(consentMigration).toMatch(/invalid_consent_type/i);
  });

  it('records the caller and the tenant on every consent row it writes', () => {
    expect(consentMigration).toMatch(/INSERT\s+INTO\s+(?:public\.)?consent_records/i);
    expect(consentMigration).toMatch(/user_id\s*=\s*v_user_id/i);
  });
});

describe('consent write path in the web client', () => {
  it('never falls back to a direct consent_records insert', () => {
    expect(consentRow).not.toMatch(/\.from\(['"]consent_records['"]\)/);
  });

  it('routes the toggle through the consent RPC only', () => {
    expect(consentRow).toContain("supabase.rpc('set_user_consent'");
  });

  it('keeps the compliance read model on the RLS-scoped client', () => {
    expect(consentPage).toContain("from('consent_records')");
  });
});
