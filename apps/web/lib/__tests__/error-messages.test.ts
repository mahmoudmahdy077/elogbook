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
});
