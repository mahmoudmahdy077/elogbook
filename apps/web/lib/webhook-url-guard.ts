/**
 * SSRF guard for tenant-supplied webhook URLs.
 *
 * Webhook URLs are entered by a tenant admin and fetched by this server, which
 * puts them in the same trust class as any other user-supplied URL: without a
 * check, `http://169.254.169.254/…` or `http://db:5432` reaches the cloud
 * metadata service or the internal Docker network.
 *
 * `assertSafeWebhookUrl` rejects:
 *  - non-http(s) schemes and URLs with embedded credentials;
 *  - loopback / link-local / private / CGNAT / multicast / documentation
 *    ranges (IPv4 and IPv6, including IPv4-mapped IPv6 and NAT64);
 *  - hostnames that are literally `localhost`, `*.local`, `*.internal`,
 *    `*.home.arpa` or the cloud metadata names;
 *  - hostnames whose DNS answers include any blocked address.
 *
 * Callers must also disable redirects (`redirect: 'manual'`), otherwise the
 * receiver can bounce the request to a blocked address after this check.
 *
 * Residual risk: DNS is resolved here and again by `fetch`, so a name with a
 * very short TTL can rebind between the two lookups. Closing that fully needs
 * a pinned-IP HTTP agent; this guard removes the trivial cases, which is what
 * a tenant admin can exploit by accident or by hand.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.svc', '.cluster.local'];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function ipv4ToInt(octets: number[]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

const BLOCKED_V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return true; // unparseable: fail closed
  const value = ipv4ToInt(octets);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const [b0, b1, b2, b3] = base.split('.').map(Number);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt([b0, b1, b2, b3]) & mask);
  });
}

/** Expand an IPv6 literal to eight 16-bit groups, or null when invalid. */
function parseIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone); // link-local zone id

  // Trailing embedded IPv4 (e.g. ::ffff:10.0.0.1)
  let embedded: number[] | null = null;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    embedded = parseIpv4(tail);
    if (!embedded) return null;
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let groups: number[];
  if (halves.length === 2) {
    const left = toGroups(halves[0]);
    const right = toGroups(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill(0), ...right];
  } else {
    const all = toGroups(halves[0]);
    if (!all) return null;
    groups = all;
  }

  if (groups.length !== 8) return null;
  if (embedded) {
    groups[6] = (embedded[0] << 8) | embedded[1];
    groups[7] = (embedded[2] << 8) | embedded[3];
  }
  return groups;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version !== 6) return true; // not an IP: fail closed for direct calls

  const groups = parseIpv6(ip);
  if (!groups) return true;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  // :: and ::1
  if (groups.every((g) => g === 0)) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true;

  // IPv4-mapped ::ffff:0:0/96
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const v4 = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(v4);
  }

  // NAT64 64:ff9b::/96 — block: it can wrap any IPv4, including private ones.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;

  // fc00::/7 unique local
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  // 2002::/16 6to4 — embeds an IPv4 that we cannot classify reliably
  if (g0 === 0x2002) return true;
  // 100::/64 discard-only
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;

  return false;
}

export interface WebhookUrlGuardOptions {
  /** Require https (production). Default false so self-hosted http works. */
  requireHttps?: boolean;
  /** Injectable resolver for tests; defaults to node:dns lookup. */
  resolve?: (hostname: string) => Promise<Array<{ address: string }>>;
}

/**
 * Validate a webhook URL and return the parsed URL.
 * Throws `UnsafeWebhookUrlError` with a caller-safe reason.
 */
export async function assertSafeWebhookUrl(
  raw: string,
  options: WebhookUrlGuardOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError('Invalid URL format');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeWebhookUrlError('URL must use http or https');
  }
  if (options.requireHttps && url.protocol !== 'https:') {
    throw new UnsafeWebhookUrlError('HTTPS is required');
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError('URL must not contain credentials');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isBlockedHostname(host)) {
    throw new UnsafeWebhookUrlError('URL host is not allowed');
  }

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new UnsafeWebhookUrlError('URL host is not allowed');
    return url;
  }

  const resolve = options.resolve ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));

  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeWebhookUrlError('URL host could not be resolved');
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError('URL host could not be resolved');
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new UnsafeWebhookUrlError('URL host resolves to a private address');
  }

  return url;
}
