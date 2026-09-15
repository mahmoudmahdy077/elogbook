/**
 * M4 — safe attachment handling (local-first).
 *
 * MIME/size/name validation, encrypted-temp-file contract (callers must
 * store temps via AEAD + delete after upload), resumability/retention via
 * SyncEngine outbox, and URI/token redaction for logs/telemetry.
 * No URI, token, or PHI ever reaches logs, Sentry, analytics, or
 * notification previews — use redactUri() at every call site.
 */

export const ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  allowedMime: new Set(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']),
};

export interface AttachmentMeta {
  mime: string;
  sizeBytes: number;
  name: string;
}

export function validateAttachment(meta: AttachmentMeta): { ok: boolean; reason?: string } {
  if (!ATTACHMENT_LIMITS.allowedMime.has(meta.mime)) return { ok: false, reason: `mime not allowed: ${meta.mime}` };
  if (meta.sizeBytes <= 0 || meta.sizeBytes > ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, reason: 'size out of bounds' };
  }
  if (meta.name.includes('..') || meta.name.includes('/') || meta.name.includes('\\')) {
    return { ok: false, reason: 'path traversal' };
  }
  if (/[?&#]/.test(meta.name) || /token|apikey|secret|signature/i.test(meta.name)) {
    return { ok: false, reason: 'name must not carry query/token' };
  }
  return { ok: true };
}

/** Strip query/fragment and any token-like segments for safe logging. */
export function redactUri(uri: string): string {
  try {
    const q = uri.indexOf('?');
    const h = uri.indexOf('#');
    const cut = q >= 0 ? q : h >= 0 ? h : -1;
    const base = cut >= 0 ? uri.slice(0, cut) : uri;
    // Keep only the last path segment, drop directories that may leak IDs.
    const last = base.split('/').pop() ?? '[file]';
    const safe = last.replace(/(token|key|sig|secret)[^_.-]*/gi, '[redacted]');
    return `[file:${safe || 'attachment'}]`;
  } catch {
    return '[file]';
  }
}
