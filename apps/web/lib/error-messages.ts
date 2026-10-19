import * as Sentry from '@sentry/nextjs';
import { redact } from './observability/redact';

const patterns: [RegExp, string][] = [
  [/23505|duplicate key|unique constraint/i, 'This record already exists.'],
  // Ahead of the generic permission message: an AAL2 step-up is recoverable by
  // the user, and telling them "you don't have permission" would misreport a
  // signing requirement as an authorization failure.
  [
    /SEC-0(04|10|11|16)|requires re-authentication at AAL2/i,
    'Filing this clinical record requires a recent MFA verification. Verify your identity, then submit again.',
  ],
  [/42501|permission denied|violates row.level security/i, "You don't have permission to do this."],
  [/23503|foreign key/i, 'This record is linked to other data and cannot be changed.'],
  [/23514|violates check/i, 'The data entered violates a validation rule.'],
  [/22P02|invalid input syntax/i, 'Invalid data format entered.'],
  [/40001|serialization failure/i, 'A conflict occurred. Please try again.'],
  [/40P01|deadlock detected/i, 'A system conflict occurred. Please try again.'],
  [/EmailNotConfirmed/i, 'Please confirm your email address before signing in.'],
  [/InvalidLoginCredentials|invalid_credentials/i, 'Invalid email or password.'],
  [/OtpExpired/i, 'The verification code has expired. Request a new one.'],
  [/SmtpError/i, 'Unable to send email. Please try again later.'],
  [/UserAlreadyRegistered/i, 'An account with this email already exists.'],
  [/RateLimitExceeded/i, 'Too many attempts. Please wait and try again.'],
  [/Failed to fetch|NetworkError|Network request failed/i, 'A network error occurred. Check your connection.'],
  [/timeout/i, 'The request timed out. Please try again.'],
  [/abort/i, 'The request was cancelled.'],
];

export function toUserMessage(raw: string): string {
  const redacted = redact({ message: raw });
  const safeMessage = typeof redacted.message === 'string' ? redacted.message : '[REDACTED]';
  Sentry.captureMessage(safeMessage, 'info');

  for (const [regex, message] of patterns) {
    if (regex.test(raw)) return message;
  }

  return 'Something went wrong. Please try again. If the problem persists, contact support.';
}
