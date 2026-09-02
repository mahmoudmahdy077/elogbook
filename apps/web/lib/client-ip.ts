/**
 * Centralized client-IP derivation with explicit trust boundary.
 *
 * TRUST BOUNDARY (TICKET-002):
 *  - Caddy is the only ingress (app:3000 not published, see docker-compose.yml).
 *  - Caddy terminates TLS and *appends* the remote address to any incoming
 *    X-Forwarded-For header. The first element stays client-controlled.
 *  - `trusted_proxies private_ranges` is configured in Caddy (config/Caddyfile).
 *  - `TRUSTED_PROXY_HOPS` (required in production, default 0) is the number of
 *    trailing entries in X-Forwarded-For that are trusted. 0 means "trust
 *    nothing" — ignore the header entirely and use the socket peer (the
 *    proxy's address) or X-Real-IP. 1 (pilot default) means the last entry was
 *    added by Caddy and is the real client IP as seen by the proxy.
 *  - Direct access to app:3000 without the proxy is impossible in the
 *    composed stack, so the hop count is meaningful. If the port were
 *    published (D-10) this entire function would be unsound.
 *
 * Mapping to test matrix (5 cases):
 *  1. direct with no header -> hops=0 or hops=1 with single entry: returns that entry
 *  2. spoofed header with hops=0 -> header ignored, returns X-Real-IP/unknown
 *  3. multiple hops hops=1 -> last entry; hops=2 -> second-last
 *  4. header absent behind proxy -> fallback to X-Real-IP or unknown
 *  5. IPv6 including bracketed, port-stripped, and IPv4-mapped
 */

function parseTrustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Normalize a single XFF token:
 *  - trim whitespace
 *  - strip surrounding brackets for IPv6: "[2001:db8::1]" -> "2001:db8::1"
 *  - strip bracketed port: "[2001:db8::1]:1234" -> "2001:db8::1"
 *  - strip IPv4 port: "1.2.3.4:1234" -> "1.2.3.4" (but not for bare IPv6)
 *  - lower-case (IPv6 hex)
 */
export function normalizeIpToken(token: string): string {
  let s = token.trim();
  if (!s) return '';

  // Bracketed IPv6 with optional port: [addr] or [addr]:port
  const bracketMatch = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) {
    return bracketMatch[1].toLowerCase();
  }

  // IPv4 with port: 1.2.3.4:1234 -> strip port
  // Distinguish from bare IPv6 by counting colons: IPv4 has 0-1 colon for port,
  // IPv6 has >=2 colons.
  const colonCount = (s.match(/:/g) || []).length;
  if (colonCount === 1 && s.includes('.')) {
    // likely ipv4:port
    const lastColon = s.lastIndexOf(':');
    const portPart = s.slice(lastColon + 1);
    if (/^\d+$/.test(portPart)) {
      s = s.slice(0, lastColon);
    }
  }

  // Handle IPv4-mapped IPv6: ::ffff:1.2.3.4 — keep as is, lowercased
  return s.toLowerCase();
}

export function getClientIp(
  request: { headers: Headers } & Partial<{ ip?: string | null }>,
): string {
  const hops = parseTrustedHops();

  // Hops == 0: trust nothing — ignore XFF entirely.
  if (hops === 0) {
    // Prefer platform-verified socket address if available (NextRequest.ip),
    // then X-Real-IP (set by Caddy as header_up X-Real-IP {remote}), else unknown.
    const viaIp = (request as { ip?: string | null }).ip;
    if (viaIp && typeof viaIp === 'string' && viaIp.trim()) {
      return normalizeIpToken(viaIp) || 'unknown';
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp && realIp.trim()) {
      return normalizeIpToken(realIp) || 'unknown';
    }
    // No trusted header — do not fall back to XFF
    return 'unknown';
  }

  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) {
    const parts = xff
      .split(',')
      .map((p) => normalizeIpToken(p))
      .filter((p) => p.length > 0);

    if (parts.length > 0) {
      // With hops trusted, the client IP is `hops` entries from the end.
      // Example: hops=1, header "spoofed, real" -> last is real.
      // hops=2, header "spoofed, real, proxy1" -> second-last is real? But our
      // single-Caddy pilot uses hops=1; the formula generalizes.
      if (parts.length >= hops) {
        const idx = parts.length - hops;
        // Clamp: if hops=1, idx = length-1 (last); hops=2, length-2 (second-last)
        const candidate = parts[idx] ?? parts[parts.length - 1];
        if (candidate) return candidate;
      } else {
        // Fewer entries than trusted hops — header is shorter than expected
        // (e.g., no header but hops=1, or spoofed single entry with hops=2).
        // Fall through to X-Real-IP fallback rather than returning spoofed value.
      }
    }
  }

  // Fallback when XFF missing or insufficient entries
  const viaIp = (request as { ip?: string | null }).ip;
  if (viaIp && viaIp.trim()) return normalizeIpToken(viaIp) || 'unknown';
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return normalizeIpToken(realIp) || 'unknown';
  return 'unknown';
}
