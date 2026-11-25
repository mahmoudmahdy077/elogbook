/**
 * Normalisation of the Supabase public connection settings.
 *
 * Why this exists: `createServerClient()` from `@supabase/ssr` throws
 * "Invalid supabaseUrl" on any value that is not an absolute http(s) URL.
 * In the Next.js proxy (middleware) that throw happens before a single
 * route runs, so one badly-pasted dashboard value — most often a URL
 * wrapped in quotes, or a bare host without `https://` — takes down every
 * dynamic route, including `/api/health`, with an opaque
 * `MIDDLEWARE_INVOCATION_FAILED`.
 *
 * The value is a public connection string, not a secret: the fix is to
 * accept the shapes people actually paste and normalise them, instead of
 * demanding byte-perfect input. Genuinely unusable values are still
 * rejected, with a reason that is safe to log and to show to an operator
 * (it never echoes the value).
 *
 * Kept dependency-free so it can be imported from the Edge middleware
 * bundle without pulling `zod` in with it.
 */

export type NormalizedSupabaseUrl =
  | { ok: true; url: string }
  | { ok: false; kind: 'missing' | 'invalid'; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** Strip one matching pair of surrounding single or double quotes. */
function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Normalise a Supabase project URL.
 *
 * Accepts: `https://ref.supabase.co`, `https://ref.supabase.co/`,
 * `"https://ref.supabase.co"` (quoted paste), `ref.supabase.co`
 * (scheme omitted in the dashboard) and `http://localhost:54321`.
 * Rejects anything that still is not an absolute http(s) URL with a host.
 */
export function normalizeSupabaseUrl(raw: string | undefined | null): NormalizedSupabaseUrl {
  const trimmed = stripSurroundingQuotes(String(raw ?? '').trim());

  if (!trimmed) {
    return {
      ok: false,
      kind: 'missing',
      reason: 'NEXT_PUBLIC_SUPABASE_URL is not set',
    };
  }

  // A value that still carries quote characters is not recoverable: it is
  // either only half-quoted or contains them in the middle of the host.
  if (trimmed.includes('"') || trimmed.includes("'")) {
    return {
      ok: false,
      kind: 'invalid',
      reason: 'NEXT_PUBLIC_SUPABASE_URL contains quote characters',
    };
  }

  let candidate = trimmed;

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    // Dashboard paste without a scheme. Loopback deployments speak http;
    // everything else is served over https.
    const host = candidate.split('/')[0].split(':')[0].toLowerCase();
    candidate = `${LOCAL_HOSTS.has(host) || host.startsWith('127.') ? 'http' : 'https'}://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      kind: 'invalid',
      reason: 'NEXT_PUBLIC_SUPABASE_URL is not a valid URL',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      kind: 'invalid',
      reason: 'NEXT_PUBLIC_SUPABASE_URL must use http:// or https://',
    };
  }

  if (!parsed.hostname) {
    return {
      ok: false,
      kind: 'invalid',
      reason: 'NEXT_PUBLIC_SUPABASE_URL has no host',
    };
  }

  return { ok: true, url: parsed.toString().replace(/\/$/, '') };
}

/**
 * Normalise the anon key. A quoted paste here does not crash the app the
 * way a bad URL does — it just makes every auth call return 401 — so it is
 * worth unwrapping for the same reason.
 */
export function normalizeSupabaseKey(raw: string | undefined | null): string {
  return stripSurroundingQuotes(String(raw ?? '').trim());
}
