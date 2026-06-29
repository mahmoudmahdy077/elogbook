import { describe, it, expect } from 'vitest';
import { isMfaRequiredForRole, MFA_REQUIRED_ROLES } from '../supabase/auth';

describe('isMfaRequiredForRole (P6.1)', () => {
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

  it('exposes the canonical list of roles that require MFA', () => {
    expect(MFA_REQUIRED_ROLES).toEqual(['director', 'institution_admin', 'admin']);
  });
});
