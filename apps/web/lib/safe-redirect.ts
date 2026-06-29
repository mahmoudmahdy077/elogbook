/**
 * Validate a user-supplied redirect path to prevent open-redirect attacks.
 *
 * An attacker who controls a `?next=` parameter on /login or /auth/callback
 * could otherwise redirect the user to an attacker-controlled site
 * (e.g. https://evil.com/phish) after authentication — enabling credential
 * phishing or post-auth cookie theft.
 *
 * The function accepts only paths that:
 *   - Are non-empty
 *   - Start with a single `/`
 *   - Do NOT start with `//` (protocol-relative URL)
 *   - Do NOT start with `/\` (backslash-relative URL on some browsers)
 *
 * Anything else is replaced with the safe default `/`.
 */
export function safeRelativePath(input: string | null | undefined): string {
  if (!input) return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  if (input.startsWith('/\\')) return '/';
  return input;
}
