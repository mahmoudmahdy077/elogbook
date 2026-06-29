import { describe, it, expect } from 'vitest';

// Mirror of the toCsv function in the page (extracted here for testability).
// Mirrors the CSV escaping rules in apps/web/app/(authenticated)/[tenant]/audit/page.tsx.
function toCsv(rows: Record<string, unknown>[]): string {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
}

describe('audit CSV export (P6.7)', () => {
  it('emits a header row', () => {
    const csv = toCsv([{ id: '1', action: 'login' }]);
    expect(csv.split('\n')[0]).toBe('id,action');
  });

  it('emits one row per record', () => {
    const csv = toCsv([
      { id: '1', action: 'login' },
      { id: '2', action: 'logout' },
    ]);
    expect(csv.split('\n')).toHaveLength(3);
  });

  it('quotes fields containing commas', () => {
    const csv = toCsv([{ id: '1', action: 'role,change' }]);
    expect(csv).toContain('"role,change"');
  });

  it('doubles internal quotes', () => {
    const csv = toCsv([{ id: '1', action: 'say "hi"' }]);
    expect(csv).toContain('"say ""hi"""');
  });

  it('escapes newlines inside fields', () => {
    const csv = toCsv([{ id: '1', action: 'line1\nline2' }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('handles null and undefined as empty strings', () => {
    const csv = toCsv([{ id: '1', action: null, resource: undefined }]);
    expect(csv).toContain('1,,');
  });
});
