import { describe, it, expect } from 'vitest';
import { localWeekStartISO, toLocalDateISO } from '../date';

describe('local calendar dates', () => {
  it('formats the local day, not the UTC day', () => {
    // 01:00 local is still the previous day in UTC for positive offsets.
    expect(toLocalDateISO(new Date(2026, 0, 2, 1, 0, 0))).toBe('2026-01-02');
  });

  it('returns the Monday of the local week', () => {
    // 2026-11-29 is a Sunday; its week starts on Monday 2026-11-23.
    expect(localWeekStartISO(new Date(2026, 10, 29, 23, 30))).toBe('2026-11-23');
    expect(localWeekStartISO(new Date(2026, 10, 23, 9, 0))).toBe('2026-11-23');
  });
});
