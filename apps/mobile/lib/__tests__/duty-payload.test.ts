import { describe, it, expect } from 'vitest';
import { buildDutyPeriodPayload } from '../duty-payload';

describe('buildDutyPeriodPayload', () => {
  it('uses the profile row id as resident_id, not undefined', () => {
    const payload = buildDutyPeriodPayload(
      { id: 'profile-1', tenant_id: 'tenant-1' },
      new Date('2026-08-12T10:00:00Z'),
      '8.5',
      'regular',
      '',
    );
    expect(payload.resident_id).toBe('profile-1');
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.shift_date).toBe('2026-08-12');
    expect(payload.hours_worked).toBe(8.5);
    expect(payload.notes).toBeNull();
  });
});
