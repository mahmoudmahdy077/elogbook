/**
 * URL redaction for anything written to logs or to audit_logs.
 *
 * Webhook URLs routinely carry the credential in the path rather than a
 * header (Slack: /services/T…/B…/…, Discord: /api/webhooks/<id>/<token>,
 * Teams, Zapier, custom relays). Those paths are bearer secrets: whoever
 * reads one can post into the destination channel. audit_logs is readable by
 * every tenant admin and supervisor, is exported by the compliance tooling,
 * and is retained far longer than the webhook row itself, so the full URL
 * must never be stored there.
 *
 * `redactUrl` keeps only the scheme and host, which is what an auditor needs
 * to recognise the destination, and drops the path, query and fragment.
 */

const FALLBACK = 'unknown';

export function redactUrl(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK;
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not a parseable URL — do not echo the raw string back into the log.
    return FALLBACK;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return FALLBACK;
  }

  // Only the origin: no path, no query, no fragment, no userinfo.
  return parsed.origin;
}
