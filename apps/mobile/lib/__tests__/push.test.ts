import { describe, it, expect } from 'vitest';
import { notificationPayloadToBadgeIncrement } from '../notification-payload';

describe('notificationPayloadToBadgeIncrement', () => {
  it('returns 1 for approval events', () => {
    expect(notificationPayloadToBadgeIncrement('case.approved')).toBe(1);
    expect(notificationPayloadToBadgeIncrement('case.rejected')).toBe(1);
    expect(notificationPayloadToBadgeIncrement('approval.pending')).toBe(1);
  });
  it('returns 0 for anything else', () => {
    expect(notificationPayloadToBadgeIncrement('deep.link')).toBe(0);
    expect(notificationPayloadToBadgeIncrement(undefined)).toBe(0);
  });
});
