import { describe, it, expect } from 'vitest';
import { pickMaxServerUpdatedAt } from '../sync-incremental';

describe('pickMaxServerUpdatedAt', () => {
  it('returns 0 for empty input', () => {
    expect(pickMaxServerUpdatedAt([])).toBe(0);
  });

  it('returns the timestamp of the only row', () => {
    expect(pickMaxServerUpdatedAt([{ updated_at: '2026-06-29T12:00:00.000Z' }])).toBe(
      Date.parse('2026-06-29T12:00:00.000Z'),
    );
  });

  it('returns the max timestamp across rows', () => {
    const rows = [
      { updated_at: '2026-06-29T10:00:00.000Z' },
      { updated_at: '2026-06-29T12:34:56.000Z' },
      { updated_at: '2026-06-29T11:00:00.000Z' },
    ];
    expect(pickMaxServerUpdatedAt(rows)).toBe(Date.parse('2026-06-29T12:34:56.000Z'));
  });

  it('skips unparseable timestamps and still returns the max of the rest', () => {
    const rows = [
      { updated_at: '2026-06-29T10:00:00.000Z' },
      { updated_at: 'not-a-date' },
      { updated_at: '2026-06-29T11:00:00.000Z' },
    ];
    expect(pickMaxServerUpdatedAt(rows)).toBe(Date.parse('2026-06-29T11:00:00.000Z'));
  });

  it('returns 0 when every row has an unparseable timestamp', () => {
    expect(pickMaxServerUpdatedAt([{ updated_at: 'nope' }, { updated_at: '' }])).toBe(0);
  });

  it('handles numeric (epoch ms) timestamps', () => {
    const rows = [{ updated_at: 1700000000000 }, { updated_at: 1800000000000 }];
    expect(pickMaxServerUpdatedAt(rows)).toBe(1800000000000);
  });
});
