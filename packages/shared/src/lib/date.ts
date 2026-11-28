/**
 * Local calendar date as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date: in Riyadh
 * (UTC+3) it still says yesterday for the first three hours of the local day,
 * so "today's cases", default case dates and the duty week were wrong. Use
 * the device's local components instead.
 */
export function toLocalDateISO(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Monday-start week containing `date`, as a local YYYY-MM-DD. */
export function localWeekStartISO(date: Date = new Date()): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return toLocalDateISO(monday);
}
