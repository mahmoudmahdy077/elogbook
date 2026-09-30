// packages/shared/src/email/suppressions.ts
export function isSuppressed(email: string, suppressedSet: Set<string>): boolean {
  return suppressedSet.has(email.trim().toLowerCase());
}
export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
