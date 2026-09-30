export type OutboundUrlPolicy = {
  allowedHosts?: readonly string[];
  allowedPorts?: readonly number[];
  allowHttp?: boolean;
  allowCredentials?: boolean;
  allowCrossHostRedirects?: boolean;
};

export class OutboundUrlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OutboundUrlError";
    this.code = code;
  }
}

const blockedHostNames = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data.ec2.internal",
  "local-host",
  "host.docker.internal",
  "host.containers.internal",
  "kubernetes.default.svc",
]);

function parseIpv4Part(value: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^0\d+$/.test(value)) {
    return /^0[0-7]+$/.test(value) ? Number.parseInt(value.slice(1), 8) : null;
  }
  return /^\d+$/.test(value) ? Number(value) : null;
}

function parseIpv4(value: string): number[] | null {
  if (!/^[0-9a-fx.]+$/i.test(value)) return null;
  const parts = value.split(".");
  if (parts.length > 4 || parts.some((part) => !part)) return null;
  const numbers = parts.map(parseIpv4Part);
  if (numbers.some((part) => part === null)) return null;
  if (parts.length === 1) {
    const number = numbers[0] as number;
    if (number > 0xffffffff) return null;
    return [
      (number >>> 24) & 255,
      (number >>> 16) & 255,
      (number >>> 8) & 255,
      number & 255,
    ];
  }
  if (numbers.some((number) => number !== null && number > 255)) return null;
  if (parts.length === 2) {
    return [numbers[0] as number, numbers[1] as number, 0, 0];
  }
  if (parts.length === 3) {
    return [
      numbers[0] as number,
      numbers[1] as number,
      numbers[2] as number,
      0,
    ];
  }
  return numbers as number[];
}

function parseIpv6(value: string): number[] | null {
  if (
    !value.includes(":") || value.includes("%") || value.split("::").length > 2
  ) return null;
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups: number[] = [];
  const append = (part: string): boolean => {
    if (part.includes(".")) {
      const embedded = parseIpv4(part);
      if (!embedded || groups.length > 6) return false;
      groups.push(
        (embedded[0] << 8) | embedded[1],
        (embedded[2] << 8) | embedded[3],
      );
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return false;
    groups.push(Number.parseInt(part, 16));
    return true;
  };
  if (!left.every(append) || !right.every(append)) return null;
  const missing = 8 - groups.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = halves.length === 1 ? groups : [
    ...groups.slice(0, left.length),
    ...Array.from({ length: missing }, () => 0),
    ...groups.slice(left.length),
  ];
  if (all.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of all) bytes.push((group >>> 8) & 255, group & 255);
  return bytes;
}

export function isBlockedIpAddress(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized !== value) return false;
  const raw = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  const ipv4 = parseIpv4(raw);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  const ipv6 = parseIpv6(raw);
  if (!ipv6) return false;
  const first = ipv6[0];
  const second = ipv6[1];
  if (first === 0xff || (first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xfe && (second & 0xc0) === 0xc0) return true;
  if (first === 0x2001 && (second === 0x0db8 || second === 0x0000)) return true;
  if (first === 0x2002 || (first === 0x00 && second === 0xff9b)) return true;
  if (
    first === 0 && ipv6.slice(0, 15).every((byte) => byte === 0) &&
    ipv6[15] === 1
  ) return true;
  if (
    first === 0 && ipv6.slice(0, 10).every((byte) => byte === 0) &&
    ipv6[10] === 0xff && ipv6[11] === 0xff
  ) {
    return isBlockedIpAddress(ipv6.slice(12).join("."));
  }
  if (
    first === 0 && ipv6.slice(0, 12).every((byte) => byte === 0) &&
    ipv6.slice(12).some((byte) => byte !== 0)
  ) {
    return isBlockedIpAddress(ipv6.slice(12).join("."));
  }
  return false;
}

export function isValidIpAddress(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized !== value) return false;
  const raw = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  return parseIpv4(raw) !== null || parseIpv6(raw) !== null;
}

function hostname(value: string): string {
  const raw = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return raw.toLowerCase().replace(/\.$/, "");
}

function allowed(
  hostnameValue: string,
  allowedHosts: readonly string[] | undefined,
): boolean {
  if (allowedHosts === undefined) return true;
  return allowedHosts.some((entry) => {
    const wildcard = entry.trim().startsWith("*.");
    const value = entry.trim().toLowerCase().replace(/^\*\./, "").replace(
      /\.$/,
      "",
    );
    return wildcard
      ? hostnameValue.endsWith(`.${value}`)
      : hostnameValue === value;
  });
}

function runningInProduction(): boolean {
  const runtime = globalThis as {
    process?: { env?: { NODE_ENV?: string } };
    Deno?: { env?: { get: (key: string) => string | undefined } };
  };
  return runtime.process?.env?.NODE_ENV === "production" ||
    runtime.Deno?.env?.get("DENO_ENV") === "production";
}

export function validateOutboundUrl(
  value: string,
  options: OutboundUrlPolicy = {},
): URL {
  if (
    !value || value.trim() !== value || /[\u0000-\u001f\u007f\\\s]/.test(value)
  ) {
    throw new OutboundUrlError("invalid_url", "Outbound URL is invalid");
  }
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";
  if (authority.includes("%") || authority.includes("@")) {
    throw new OutboundUrlError(
      "invalid_url",
      "Outbound URL authority is invalid",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlError("invalid_url", "Outbound URL is invalid");
  }
  if (
    url.protocol !== "https:" &&
    !(options.allowHttp === true && !runningInProduction() &&
      url.protocol === "http:")
  ) {
    throw new OutboundUrlError(
      "protocol_not_allowed",
      "Outbound URL protocol is not allowed",
    );
  }
  if ((url.username || url.password) && options.allowCredentials !== true) {
    throw new OutboundUrlError(
      "credentials_not_allowed",
      "Outbound URL credentials are not allowed",
    );
  }
  if (
    url.port &&
    (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 ||
      Number(url.port) > 65535)
  ) {
    throw new OutboundUrlError("invalid_port", "Outbound URL port is invalid");
  }
  if (options.allowedPorts?.length) {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!options.allowedPorts.includes(port)) {
      throw new OutboundUrlError(
        "invalid_port",
        "Outbound URL port is not allowed",
      );
    }
  }
  const host = hostname(url.hostname);
  if (
    !host || blockedHostNames.has(host) || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.endsWith(".local-host") || host.endsWith(".svc") ||
    isBlockedIpAddress(host) || /^[0-9]+$/.test(host) ||
    /^0x[0-9a-f]+$/i.test(host) || /^[0-9.]+$/.test(host)
  ) {
    throw new OutboundUrlError("blocked_host", "Outbound URL host is blocked");
  }
  if (!allowed(host, options.allowedHosts)) {
    throw new OutboundUrlError(
      "host_not_allowed",
      "Outbound URL host is not approved",
    );
  }
  return url;
}

export function isSafeOutboundUrl(
  value: string,
  options: OutboundUrlPolicy = {},
): boolean {
  try {
    validateOutboundUrl(value, options);
    return true;
  } catch {
    return false;
  }
}

export function validateResolvedAddresses(
  hostnameValue: string,
  addresses: readonly (string | { address: string })[],
): string[] {
  if (addresses.length === 0) {
    throw new OutboundUrlError("invalid_address", "No resolved addresses");
  }
  return addresses.map((entry) => {
    const address = typeof entry === "string" ? entry : entry.address;
    if (!isValidIpAddress(address)) {
      throw new OutboundUrlError(
        "invalid_address",
        "Resolved address is invalid",
      );
    }
    if (isBlockedIpAddress(address)) {
      throw new OutboundUrlError("blocked_host", "Resolved address is blocked");
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
    (next.protocol !== currentUrl.protocol ||
      hostname(next.hostname) !== hostname(currentUrl.hostname) ||
      next.port !== currentUrl.port)
  ) {
    throw new OutboundUrlError("blocked_host", "Redirect origin changed");
  }
  return next;
}
