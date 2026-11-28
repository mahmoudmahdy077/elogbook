/**
 * MFA policy for the mobile app.
 *
 * The web shell redirects director / institution_admin / admin to `/mfa`
 * until the session is AAL2. The app had no equivalent check, so a privileged
 * user signing in with only a password could use the phone at AAL1. The gate
 * component enforces the same rule; this module keeps the role list in one
 * testable place.
 */

import type { UserRole } from '@elogbook/shared';

export const MFA_REQUIRED_ROLES: ReadonlyArray<UserRole> = [
  'director',
  'institution_admin',
  'admin',
];

export function roleRequiresMfa(role: string | null | undefined): boolean {
  if (!role) return false;
  return (MFA_REQUIRED_ROLES as ReadonlyArray<string>).includes(role);
}
