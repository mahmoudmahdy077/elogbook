import { describe, it, expect } from 'vitest';
import { roleRequiresMfa } from '../mfa';

describe('mobile MFA policy', () => {
  it('requires MFA for the privileged web roles', () => {
    expect(roleRequiresMfa('director')).toBe(true);
    expect(roleRequiresMfa('institution_admin')).toBe(true);
    expect(roleRequiresMfa('admin')).toBe(true);
  });

  it('does not gate residents or supervisors', () => {
    expect(roleRequiresMfa('resident')).toBe(false);
    expect(roleRequiresMfa('supervisor')).toBe(false);
    expect(roleRequiresMfa(null)).toBe(false);
    expect(roleRequiresMfa(undefined)).toBe(false);
  });
});
