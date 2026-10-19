export type OutboundUrlPolicy = {
  allowedHosts?: readonly string[];
  allowedPorts?: readonly number[];
  allowHttp?: boolean;
  allowCredentials?: boolean;
  allowCrossHostRedirects?: boolean;
};

export type ParsedIp = {
  version: 4 | 6;
  bytes: number[];
  normalized: string;
};

export type OutboundUrlErrorCode =
  | 'invalid_url'
  | 'protocol_not_allowed'
  | 'credentials_not_allowed'
  | 'invalid_port'
  | 'host_not_allowed'
  | 'blocked_host'
  | 'invalid_address';

export class OutboundUrlError extends Error {
  readonly code: OutboundUrlErrorCode;

  constructor(code: OutboundUrlErrorCode, message: string) {
    super(message);
    this.name = 'OutboundUrlError';
    this.code = code;
  }
}

const IPV4_PATTERN = /^[0-9a-fx.]+$/i;
const LOCAL_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data.ec2.internal',
  'local-host',
  'host.docker.internal',
  'host.containers.internal',
  'kubernetes.default.svc',
]);

function parseIpv4Part(part: string): number | null {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const value = Number.parseInt(part.slice(2), 16);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (/^0\d+$/.test(part)) {
    if (!/^0[0-7]+$/.test(part)) return null;
    const value = Number.parseInt(part.slice(1), 8);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (!/^\d+$/.test(part)) return null;
  const value = Number(part);
  return Number.isSafeInteger(value) ? value : null;
}

function parseIpv4(value: string): ParsedIp | null {
  if (!IPV4_PATTERN.test(value)) return null;
  const parts = value.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const numbers = parts.map(parseIpv4Part);
  if (numbers.some((part) => part === null)) return null;

  let octets: number[];
  if (parts.length === 1) {
    const number = numbers[0] as number;
    if (number > 0xffffffff) return null;
    octets = [
      (number >>> 24) & 0xff,
      (number >>> 16) & 0xff,
      (number >>> 8) & 0xff,
      number & 0xff,
    ];
  } else {
    const first = numbers[0] as number;
    const second = numbers[1] as number;
    const third = numbers[2] as number;
    const fourth = numbers[3] ?? undefined;
    if (first > 0xff || second > 0xff || (third !== undefined && third > 0xff) || (fourth !== undefined && fourth > 0xff)) {
      return null;
    }
    if (parts.length === 2) {
      octets = [first, second, 0, 0];
    } else if (parts.length === 3) {
      octets = [first, second, third, 0];
    } else {
      octets = [first, second, third, fourth as number];
    }
  }

  return {
    version: 4,
    bytes: octets,
    normalized: octets.join('.'),
  };
}

function parseIpv6(value: string): ParsedIp | null {
  if (!value.includes(':') || value.includes('%') || value.split('::').length > 2) return null;
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups: number[] = [];

  const appendPart = (part: string): boolean => {
    if (part.includes('.')) {
      if (groups.length > 6) return false;
      const embedded = parseIpv4(part);
      if (!embedded) return false;
      groups.push(
        ((embedded.bytes[0] << 8) | embedded.bytes[1]) >>> 0,
        ((embedded.bytes[2] << 8) | embedded.bytes[3]) >>> 0,
      );
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return false;
    groups.push(Number.parseInt(part, 16));
    return true;
  };

  if (!left.every(appendPart) || !right.every(appendPart)) return null;
  const missing = 8 - groups.length;
  if (halves.length === 1) {
    if (missing !== 0) return null;
  } else if (missing < 1) return null;

  const normalizedGroups = halves.length === 1
    ? groups
    : [...groups.slice(0, left.length), ...Array.from({ length: missing }, () => 0), ...groups.slice(left.length)];
  if (normalizedGroups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of normalizedGroups) {
    bytes.push((group >>> 8) & 0xff, group & 0xff);
  }
  return {
    version: 6,
    bytes,
    normalized: bytesToIpv6(bytes),
  };
}

export function parseIpAddress(value: string): ParsedIp | null {
  const normalized = value.trim();
  if (!normalized || normalized !== value) return null;
  const withoutBrackets = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
    return parseIpv4(withoutBrackets) ?? parseIpv6(withoutBrackets);
  }

function bytesToIpv6(bytes: number[]): string {
  const groups: string[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
  }
  return groups.join(':');
}

function isBlockedIpv4(bytes: number[]): boolean {
  const first = bytes[0];
  const second = bytes[1];
  const third = bytes[2];
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 0 && third === 0) return true;
  if (first === 192 && second === 0 && third === 2) return true;
  if (first === 192 && second === 168) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  if (first === 198 && second === 51 && third === 100) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  if (first >= 224) return true;
  return false;
}

function isBlockedIpv6(bytes: number[]): boolean {
  const first = bytes[0];
  const second = bytes[1];
  if (first === 0xff) return true;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xfe && (second & 0xc0) === 0xc0) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if (first === 0x2001 && second === 0x0000) return true;
  if (first === 0x2002) return true;
  if (first === 0x0064 && second === 0xff9b) return true;
  if (first === 0x00 && second === 0x00 && bytes.slice(2).every((byte) => byte === 0)) return true;
  if (first === 0 && bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  if (first === 0 && bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIpv4(bytes.slice(12));
  }
  if (first === 0 && bytes.slice(0, 12).every((byte) => byte === 0) && !bytes.slice(12).every((byte) => byte === 0)) {
    return isBlockedIpv4(bytes.slice(12));
  }
  return false;
}

export function isBlockedIpAddress(value: string): boolean {
  const parsed = parseIpAddress(value);
  return parsed ? parsed.version === 4 ? isBlockedIpv4(parsed.bytes) : isBlockedIpv6(parsed.bytes) : false;
}

function canonicalHostname(value: string): string {
  const withoutBrackets = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return withoutBrackets.toLowerCase().replace(/\.$/, '');
}

function isHostAllowed(hostname: string, allowedHosts: readonly string[] | undefined): boolean {
  if (allowedHosts === undefined) return true;
  return allowedHosts.some((entry) => {
    const wildcard = entry.trim().startsWith('*.');
    const normalized = canonicalHostname(entry.trim().replace(/^\*\./, ''));
    return wildcard ? hostname.endsWith(`.${normalized}`) : hostname === normalized;
  });
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = canonicalHostname(hostname);
  if (!normalized || LOCAL_HOSTS.has(normalized)) return true;
  if (normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized.endsWith('.internal') || normalized.endsWith('.local-host') || normalized.endsWith('.svc')) return true;
  if (isBlockedIpAddress(normalized)) return true;
  if (/^[0-9]+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized) || /^[0-9.]+$/.test(normalized)) {
    return true;
  }
  return false;
}

function assertPort(url: URL, allowedPorts: readonly number[] | undefined): void {
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new OutboundUrlError('invalid_port', 'Outbound URL has an invalid port');
    }
    if (allowedPorts && !allowedPorts.includes(port)) {
      throw new OutboundUrlError('invalid_port', 'Outbound URL port is not allowed');
    }
  } else if (allowedPorts && !allowedPorts.includes(url.protocol === 'https:' ? 443 : 80)) {
    throw new OutboundUrlError('invalid_port', 'Outbound URL port is not allowed');
  }
}

function runningInProduction(): boolean {
  const runtime = globalThis as {
    process?: { env?: { NODE_ENV?: string } };
    Deno?: { env?: { get: (key: string) => string | undefined } };
  };
  return runtime.process?.env?.NODE_ENV === 'production' || runtime.Deno?.env?.get('DENO_ENV') === 'production';
}

export function validateOutboundUrl(value: string, options: OutboundUrlPolicy = {}): URL {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new OutboundUrlError('invalid_url', 'Outbound URL is invalid');
  }
  if (/[\u0000-\u001f\u007f\\\s]/.test(value)) {
    throw new OutboundUrlError('invalid_url', 'Outbound URL contains invalid characters');
  }
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (authority.includes('%') || authority.includes('@')) {
    throw new OutboundUrlError('invalid_url', 'Outbound URL authority is invalid');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlError('invalid_url', 'Outbound URL is invalid');
  }
  const allowHttp = options.allowHttp === true && !runningInProduction();
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new OutboundUrlError('protocol_not_allowed', 'Outbound URL protocol is not allowed');
  }
  if (url.username || url.password) {
    if (options.allowCredentials !== true) {
      throw new OutboundUrlError('credentials_not_allowed', 'Outbound URL credentials are not allowed');
    }
  }
  assertPort(url, options.allowedPorts);
  const hostname = canonicalHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new OutboundUrlError('blocked_host', 'Outbound URL host is blocked');
  }
  if (!isHostAllowed(hostname, options.allowedHosts)) {
    throw new OutboundUrlError('host_not_allowed', 'Outbound URL host is not approved');
  }
  return url;
}

export function isSafeOutboundUrl(value: string, options: OutboundUrlPolicy = {}): boolean {
  try {
    validateOutboundUrl(value, options);
    return true;
  } catch {
    return false;
  }
}

export function validateResolvedAddresses(
  _hostname: string,
  addresses: readonly (string | { address: string })[],
  _options: OutboundUrlPolicy = {},
): string[] {
  if (addresses.length === 0) {
    throw new OutboundUrlError('invalid_address', 'Outbound hostname has no resolved addresses');
  }
  return addresses.map((entry) => {
    const address = typeof entry === 'string' ? entry : entry.address;
    if (!parseIpAddress(address)) {
      throw new OutboundUrlError('invalid_address', 'Outbound hostname returned an invalid address');
    }
    if (isBlockedIpAddress(address)) {
      throw new OutboundUrlError('blocked_host', 'Outbound hostname resolved to a blocked address');
    }
    return address;
  });
}

export function validateRedirectUrl(
  value: string,
  currentUrl: URL,
  options: OutboundUrlPolicy = {},
): URL {
  const next = validateOutboundUrl(value, options);
  if (
    options.allowCrossHostRedirects !== true &&
    (next.protocol !== currentUrl.protocol || canonicalHostname(next.hostname) !== canonicalHostname(currentUrl.hostname) || next.port !== currentUrl.port)
  ) {
    throw new OutboundUrlError('blocked_host', 'Outbound redirect changed the approved origin');
  }
  return next;
}
