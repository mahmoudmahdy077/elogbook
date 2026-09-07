/**
 * Pinned Supabase bundle records (T11).
 *
 * A provision/update may only consume a bundle whose every service image
 * is digest-pinned. Tags (`latest`, bare versions) are rejected: they are
 * mutable and unreviewable. Signature/provenance verification of the
 * bundle itself is T13; this module enforces pin *shape* so an unsigned
 * or floating reference can never reach the executor.
 */

export interface ReleasePin {
  schemaVersion: number;
  releaseId: string;
  /** Pinned upstream source, e.g. `self-hosted/v1.2.3` (never `main`). */
  source: string;
  /** Service name -> `repository@sha256:<64 hex>` */
  services: Record<string, string>;
}

const DIGEST_RE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._/-][a-z0-9]+)*)?@sha256:[0-9a-f]{64}$/;

export function validateReleasePin(pin: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof pin !== 'object' || pin === null) return { ok: false, errors: ['pin must be an object'] };
  const p = pin as Partial<ReleasePin>;
  if (p.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!p.releaseId || typeof p.releaseId !== 'string') errors.push('releaseId is required');
  if (!p.source || typeof p.source !== 'string') {
    errors.push('source is required');
  } else if (/\b(main|master|latest)\b/i.test(p.source)) {
    errors.push(`source must be a pinned release, got ${p.source}`);
  }
  if (!p.services || typeof p.services !== 'object' || Object.keys(p.services).length === 0) {
    errors.push('services must be a non-empty map');
  } else {
    for (const [name, ref] of Object.entries(p.services)) {
      if (typeof ref !== 'string' || !DIGEST_RE.test(ref)) {
        errors.push(`service ${name} must be digest-pinned (repository@sha256:...), got ${String(ref)}`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
