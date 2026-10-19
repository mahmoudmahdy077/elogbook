import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const migrationsDir = resolve(repoRoot, 'supabase', 'migrations');
const invitationMigration = readFileSync(
  join(migrationsDir, '20260926000006_invitation_signup_boundary.sql'),
  'utf8',
);
const handleNewUserMigration = readFileSync(
  join(migrationsDir, '20260925000002_pending_profile_mfa_promotion.sql'),
  'utf8',
);
const signupForm = readFileSync(resolve(repoRoot, 'apps/web/app/signup/SignupForm.tsx'), 'utf8');
const invitesPage = readFileSync(
  resolve(repoRoot, 'apps/web/app/(authenticated)/[tenant]/invites/page.tsx'),
  'utf8',
);

/** The last CREATE OR REPLACE FUNCTION body for a name is the converged one. */
function lastFunctionBody(name: string): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let body = '';
  for (const file of files) {
    const source = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of source.matchAll(
      new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\([^)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'gi'),
    )) {
      body = match[1];
    }
  }
  return body;
}

describe('tenant invitation schema', () => {
  it('adds a non-null expiry so an invitation cannot live forever', () => {
    expect(invitationMigration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+expires_at\s+TIMESTAMPTZ/i,
    );
    expect(invitationMigration).toMatch(/ALTER\s+COLUMN\s+expires_at\s+SET\s+NOT\s+NULL/i);
    expect(invitationMigration).toMatch(/SET\s+DEFAULT\s+NOW\(\)\s*\+\s*INTERVAL/i);
  });

  it('stores only a token digest and keeps the raw token out of reach', () => {
    expect(invitationMigration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+token_hash\s+TEXT/i,
    );
    expect(invitationMigration).toMatch(
      /REVOKE\s+SELECT\s*\(\s*token_hash\s*\)[\s\S]*?ON\s+(?:public\.)?tenant_invites\s+FROM[\s\S]*?authenticated/i,
    );
  });

  it('allows at most one live invitation per tenant and address', () => {
    expect(invitationMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*?tenant_invites[\s\S]*?ON\s+(?:public\.)?tenant_invites\s*\(\s*tenant_id\s*,\s*LOWER\(\s*email\s*\)\s*\)[\s\S]*?WHERE\s+status\s*=\s*'pending'/i,
    );
  });

  it('keeps the token digest unique', () => {
    expect(invitationMigration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+(?:public\.)?tenant_invites\s*\(\s*token_hash\s*\)/i,
    );
  });
});

describe('invitation redemption in the database', () => {
  it('requires a pending, unexpired invitation in an active tenant', () => {
    const body = lastFunctionBody('handle_new_user');

    expect(body).toMatch(/invites?\.expires_at\s+>\s*NOW\(\)/i);
    expect(body).toMatch(/status\s*=\s*'pending'/i);
    expect(body).toMatch(/invite_tenant\.status\s*=\s*'active'/i);
    expect(body).toMatch(/FOR\s+UPDATE\s+OF\s+invite/i);
  });

  it('no longer provisions a tenant for an un-invited signup', () => {
    const body = lastFunctionBody('handle_new_user');

    // The public-signup path: a visitor with no invitation used to be dropped
    // into the shared global-community tenant, or given a brand new individual
    // tenant. Neither happens any more.
    expect(body).not.toMatch(/global-community/i);
    expect(body).not.toMatch(/tenant_type\s*,\s*mrn_hash_salt/i);
    expect(body).not.toMatch(/'individual'/i);
  });

  it('returns without provisioning anything when no invitation matches', () => {
    const body = lastFunctionBody('handle_new_user');

    expect(body).toMatch(/IF\s+NOT\s+FOUND\s+THEN[\s\S]*?RETURN\s+NEW/i);
  });

  it('accepts the invite case-insensitively and still stamps tenant app metadata', () => {
    const body = lastFunctionBody('handle_new_user');

    expect(body).toMatch(/LOWER\(\s*invite\.email\s*\)\s*=\s*LOWER\(\s*NEW\.email\s*\)/i);
    expect(body).toMatch(/'tenant_id'\s*,\s*v_tenant_id/i);
  });

  it('keeps the bootstrap role resident until MFA promotion', () => {
    const body = lastFunctionBody('handle_new_user');

    expect(body).toMatch(/v_requested_role\s*:=\s*'resident'/i);
    expect(body).toMatch(/pending_role/i);
  });

  it('never trusts user metadata for tenant or role', () => {
    const body = lastFunctionBody('handle_new_user');

    expect(body).not.toMatch(/NEW\.raw_user_meta_data->>'tenant_id'/i);
    expect(body).not.toMatch(/COALESCE\(\s*NEW\.raw_user_meta_data->>'role'/i);
  });
});

describe('invitation email template', () => {
  const templateUpdate =
    invitationMigration.match(/UPDATE\s+(?:public\.)?email_templates[\s\S]*?;/i)?.[0] ?? '';

  it('renders only allowlisted variables so the queue never fails validation', () => {
    expect(templateUpdate).not.toBe('');
    expect(templateUpdate).toMatch(/\{\{role\}\}/i);
    expect(templateUpdate).toMatch(/\{\{onboarding_url\}\}/i);
    // {{tenant_name}} is in neither ALLOWED_PAYLOAD_KEYS nor the payload the
    // invite route enqueues, and render() throws on a missing variable, so the
    // invitation mail would never be delivered.
    expect(templateUpdate).not.toMatch(/\{\{\s*tenant_name\s*\}\}/i);
  });
});

describe('public signup is revoked at the product surface', () => {
  it('never calls supabase.auth.signUp from the signup form', () => {
    expect(signupForm).not.toMatch(/\.auth\.signUp\s*\(/);
    expect(signupForm).not.toMatch(/createClient\s*\(/);
  });

  it('redeems an invitation instead of choosing a password', () => {
    expect(signupForm).toContain('/api/invitations/accept');
    expect(signupForm).not.toMatch(/type="password"/i);
  });

  it('stops advertising a self-service registration link to tenants', () => {
    expect(invitesPage).not.toContain('/signup?tenant=');
  });

  it('keeps the historical trigger registration in the earlier migration intact', () => {
    expect(handleNewUserMigration).toContain('handle_new_user');
  });
});
