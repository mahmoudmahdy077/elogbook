/**
 * PHI display masks (UX2-018).
 *
 * Patient identifiers are masked by default everywhere they are rendered;
 * the full value only comes from POST /api/[tenant]/cases/[id]/phi-reveal,
 * which writes a `phi_view` audit row first.
 *
 * Short identifiers are masked completely: showing the last N characters of a
 * value shorter than N would reveal it in full.
 */

export function maskMrn(val: string | null | undefined): string {
  if (!val) return '—';
  if (val.length <= 4) return '*'.repeat(val.length);
  return `***-**-${val.slice(-4)}`;
}

export function maskDob(val: string | null | undefined): string {
  if (!val) return '—';
  if (val.length <= 5) return '*'.repeat(val.length);
  return `****-**-${val.slice(-2)}`;
}
