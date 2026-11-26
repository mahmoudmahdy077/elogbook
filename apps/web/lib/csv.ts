export function escapeCsvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formula injection BEFORE quoting. Testing the
  // quoted output missed every value that also contained a comma, because the
  // cell then started with `"` instead of `=`.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
