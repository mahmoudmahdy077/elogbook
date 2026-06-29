export function pickMaxServerUpdatedAt(
  rows: ReadonlyArray<Record<string, unknown>>,
): number {
  let max = 0;
  for (const row of rows) {
    const raw = row.updated_at;
    let t = 0;
    if (typeof raw === 'number') {
      t = raw;
    } else if (typeof raw === 'string' && raw.length > 0) {
      t = new Date(raw).getTime();
    }
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}
