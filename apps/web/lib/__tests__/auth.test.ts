import { describe, it, expect } from 'vitest';
import { isMfaRequiredForRole, canAccessTenant, type AuthResult } from '../supabase/auth';

describe('isMfaRequiredForRole', () => {
  it('requires MFA for director', () => {
    expect(isMfaRequiredForRole('director')).toBe(true);
  });

  it('requires MFA for institution_admin', () => {
    expect(isMfaRequiredForRole('institution_admin')).toBe(true);
  });

  it('requires MFA for admin', () => {
    expect(isMfaRequiredForRole('admin')).toBe(true);
  });

  it('does not require MFA for resident', () => {
    expect(isMfaRequiredForRole('resident')).toBe(false);
  });

  it('does not require MFA for supervisor', () => {
    expect(isMfaRequiredForRole('supervisor')).toBe(false);
  });
});

describe('canAccessTenant', () => {
  const makeAuth = (slug: string): AuthResult => ({
    user: { id: 'u-1' },
    profile: { id: 'p-1', tenant_id: 't-1', role: 'resident', full_name: 'Test', specialty: null },
    tenant: { id: 't-1', slug, tenant_type: 'institution' },
    subscription: null,
    aal: 'aal1',
    mfaRequired: false,
  });

  it('allows access when slugs match', () => {
    const auth = makeAuth('tenant-a');
    expect(canAccessTenant(auth, 'tenant-a')).toBe(true);
  });

  it('denies access when slugs differ', () => {
    const auth = makeAuth('tenant-a');
    expect(canAccessTenant(auth, 'tenant-b')).toBe(false);
  });

  it('denies access for admin to non-matching tenant', () => {
    const auth = makeAuth('tenant-a');
    expect(canAccessTenant(auth, 'tenant-c')).toBe(false);
  });
});
