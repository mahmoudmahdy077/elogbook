export function escapeCsvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  let out = s;
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    out = '"' + s.replace(/"/g, '""') + '"';
  }
  // Neutralize spreadsheet formula injection for untrusted cell content.
  if (/^[=+\-@\t]/.test(out)) {
    out = "'" + out;
  }
  return out;
}
