export const SAFE_REDIRECT_PREFIXES = [
  '/dashboard',
  '/cases',
  '/settings',
  '/onboarding',
  '/mfa/verify',
  '/mfa/enroll',
  '/login',
  '/platform',
] as const;

const TENANT_SEGMENT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TENANT_ROUTE_SEGMENTS = new Set([
  'dashboard',
  'rotations',
  'settings',
  'reports',
  'compliance',
  'onboarding',
  'milestones',
  'invites',
  'goals',
  'cases',
  'evaluations',
  'billing',
  'evaluate',
  'audit',
  'consent',
  'approvals',
  'analytics',
  'admin',
  'resident',
]);

function splitPath(value: string): { pathname: string; suffix: string } {
  const queryIndex = value.search(/[?#]/);
  if (queryIndex < 0) return { pathname: value, suffix: '' };
  return { pathname: value.slice(0, queryIndex), suffix: value.slice(queryIndex) };
}

function decodePath(pathname: string): string | null {
  let current = pathname;
  for (let i = 0; i < 4; i += 1) {
    if (!current.includes('%')) return current;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return null;
    }
  }
  return current.includes('%') ? null : current;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isAllowedPathname(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return false;
  if (hasControlCharacters(pathname) || pathname.includes('..')) return false;

  const decoded = decodePath(pathname);
  if (!decoded || decoded !== pathname) return false;
  if (decoded.startsWith('//') || decoded.includes('\\') || decoded.includes('..')) return false;

  const lower = decoded.toLowerCase();
  const segments = lower.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return false;
  if (segments.length === 0) return true;

  const staticMatch = SAFE_REDIRECT_PREFIXES.some((prefix) =>
    lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`) || lower.startsWith(`${prefix}#`),
  );
  if (staticMatch) return true;

  if (segments.length >= 2 && TENANT_SEGMENT.test(segments[0]) && TENANT_ROUTE_SEGMENTS.has(segments[1])) {
    return true;
  }

  return false;
}

export function isSafeRelativePath(input: string | null | undefined): input is string {
  if (typeof input !== 'string' || input.length === 0) return false;
  const { pathname } = splitPath(input);
  return isAllowedPathname(pathname);
}

export function safeRelativePath(input: string | null | undefined): string {
  if (!isSafeRelativePath(input)) return '/';
  return input;
}
