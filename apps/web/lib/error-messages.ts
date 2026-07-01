import * as Sentry from '@sentry/nextjs';

const patterns: [RegExp, string][] = [
  // Postgres codes
  [/23505|duplicate key|unique constraint/i, 'This record already exists.'],
  [/42501|permission denied|violates row.level security/i, "You don't have permission to do this."],
  [/23503|foreign key/i, 'This record is linked to other data and cannot be changed.'],
  [/23514|violates check/i, 'The data entered violates a validation rule.'],
  [/22P02|invalid input syntax/i, 'Invalid data format entered.'],
  [/40001|serialization failure/i, 'A conflict occurred. Please try again.'],
  [/40P01|deadlock detected/i, 'A system conflict occurred. Please try again.'],
  // Supabase auth
  [/EmailNotConfirmed/i, 'Please confirm your email address before signing in.'],
  [/InvalidLoginCredentials|invalid_credentials/i, 'Invalid email or password.'],
  [/OtpExpired/i, 'The verification code has expired. Request a new one.'],
  [/SmtpError/i, 'Unable to send email. Please try again later.'],
  [/UserAlreadyRegistered/i, 'An account with this email already exists.'],
  [/RateLimitExceeded/i, 'Too many attempts. Please wait and try again.'],
  // Network
  [/Failed to fetch|NetworkError|Network request failed/i, 'A network error occurred. Check your connection.'],
  [/timeout|Timeout/i, 'The request timed out. Please try again.'],
  [/abort|AbortError/i, 'The request was cancelled.'],
];

export function toUserMessage(raw: string): string {
  Sentry.captureMessage(raw);

  for (const [regex, message] of patterns) {
    if (regex.test(raw)) return message;
  }

  return 'Something went wrong. Please try again. If the problem persists, contact support.';
}
