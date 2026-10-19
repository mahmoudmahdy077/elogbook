import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toUserMessage } from '../error-messages';
import * as Sentry from '@sentry/nextjs';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toUserMessage', () => {
  it('maps Postgres unique violation code 23505', () => {
    expect(toUserMessage('23505: duplicate key value')).toBe('This record already exists.');
  });

  it('maps Postgres permission denied via message text', () => {
    expect(toUserMessage('permission denied for table profiles')).toBe("You don't have permission to do this.");
  });

  it('maps RLS violation with technical wording', () => {
    expect(toUserMessage('new row violates row-level security for table audit_logs')).toBe("You don't have permission to do this.");
  });

  it('maps an AAL2 step-up to an actionable message, not a permission denial', () => {
    // The clinical write guards raise 42501 with an SEC-code message. Reporting
    // that as "you don't have permission" would misdescribe a signing
    // requirement the user can satisfy by verifying MFA, so the step-up
    // patterns are matched ahead of the generic permission pattern.
    const raw = 'SEC-010: filing an evaluation requires re-authentication at AAL2';
    expect(toUserMessage(raw)).toBe(
      'Filing this clinical record requires a recent MFA verification. Verify your identity, then submit again.',
    );
    expect(toUserMessage(raw)).not.toBe("You don't have permission to do this.");
  });

  it('maps the sealed-record and write-once clinical guards to the same guidance', () => {
    const expected =
      'Filing this clinical record requires a recent MFA verification. Verify your identity, then submit again.';
    expect(toUserMessage('SEC-004: acknowledged evaluation is immutable (status completed -> acknowledged)'))
      .toBe(expected);
    expect(toUserMessage('SEC-011: faculty evaluation scores are write-once')).toBe(expected);
    expect(toUserMessage('SEC-016: the subject of an evaluation cannot file it')).toBe(expected);
  });

  it('maps Supabase InvalidLoginCredentials', () => {
    expect(toUserMessage('InvalidLoginCredentials')).toBe('Invalid email or password.');
  });

  it('maps Supabase lowercase invalid_credentials', () => {
    expect(toUserMessage('invalid_credentials')).toBe('Invalid email or password.');
  });

  it('maps Supabase EmailNotConfirmed', () => {
    expect(toUserMessage('EmailNotConfirmed')).toBe('Please confirm your email address before signing in.');
  });

  it('maps Supabase OtpExpired', () => {
    expect(toUserMessage('OtpExpired')).toBe('The verification code has expired. Request a new one.');
  });

  it('maps Supabase RateLimitExceeded', () => {
    expect(toUserMessage('RateLimitExceeded')).toBe('Too many attempts. Please wait and try again.');
  });

  it('maps network Failed to fetch', () => {
    expect(toUserMessage('Failed to fetch')).toBe('A network error occurred. Check your connection.');
  });

  it('maps network timeout', () => {
    expect(toUserMessage('Request timeout after 30s')).toBe('The request timed out. Please try again.');
  });

  it('maps abort error', () => {
    expect(toUserMessage('AbortError: The operation was aborted')).toBe('The request was cancelled.');
  });

  it('returns fallback for unmapped errors', () => {
    expect(toUserMessage('some random error')).toBe('Something went wrong. Please try again. If the problem persists, contact support.');
  });

  it('calls Sentry.captureMessage with the raw message and info level', () => {
    toUserMessage('test-error');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('test-error', 'info');
  });

  it('does not send PHI values to Sentry', () => {
    toUserMessage('request failed for jane.patient@example.test with MRN-7F3A9C');
    const sentryValue = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls[0]);
    expect(sentryValue).not.toContain('jane.patient@example.test');
    expect(sentryValue).not.toContain('MRN-7F3A9C');
  });
});
