const BILLING_PATH = /^\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/billing$/i;

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function resolvePortalReturnUrl(
  input: unknown,
  appOrigin: string,
  allowedOrigins: readonly string[],
): string | null {
  const app = canonicalOrigin(appOrigin);
  if (!app) return null;
  const allowed = new Set(
    allowedOrigins.map(canonicalOrigin).filter((origin): origin is string =>
      origin !== null
    ),
  );
  if (!allowed.has(app)) return null;
  if (input === undefined || input === null || input === "") return app;
  if (typeof input !== "string") return null;
  if (
    input !== input.trim() || hasControlCharacter(input) || input.includes("\\")
  ) {
    return null;
  }

  if (input.startsWith("/") && !input.startsWith("//")) {
    const url = new URL(input, app);
    if (url.origin !== app || !BILLING_PATH.test(url.pathname) || url.hash) {
      return null;
    }
    return url.toString();
  }

  if (input.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    !allowed.has(url.origin) || url.pathname !== "/" || url.search || url.hash
  ) return null;
  return url.origin;
}
