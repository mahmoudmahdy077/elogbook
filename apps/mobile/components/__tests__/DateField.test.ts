import { describe, it, expect } from 'vitest';

function parseISODate(iso: string): Date {
  if (!iso) return new Date(NaN);
  if (iso.length === 10) {
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  const t = new Date(iso);
  return t;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

describe('DateField helpers', () => {
  it('parses a YYYY-MM-DD string into a local Date', () => {
    const d = parseISODate('2026-06-29');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(29);
  });

  it('parses a full ISO string', () => {
    const d = parseISODate('2026-06-29T10:00:00.000Z');
    expect(d.getTime()).toBe(Date.parse('2026-06-29T10:00:00.000Z'));
  });

  it('formats a Date as YYYY-MM-DD with zero-padding', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('round-trips a YYYY-MM-DD string through parse/format', () => {
    const original = '2026-06-29';
    expect(toISODate(parseISODate(original))).toBe(original);
  });

  it('validates YYYY-MM-DD shape', () => {
    expect(isValidYmd('2026-06-29')).toBe(true);
    expect(isValidYmd('2026-1-1')).toBe(false);
    expect(isValidYmd('26-06-29')).toBe(false);
    expect(isValidYmd('')).toBe(false);
  });
});
