'use client';

import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@elogbook/shared';
import { FormField } from '@elogbook/shared/components/web';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';

/**
 * Invitation-only signup.
 *
 * Public self-service signup is revoked: it provisioned a tenant for an
 * anonymous visitor (handle_new_user either landed them in the shared
 * global-community tenant or created a fresh individual tenant for them), so
 * "create an account" was in practice "create a tenant". Accounts now exist
 * only through a tenant administrator's invitation.
 *
 * This form redeems an invitation. It never calls supabase.auth.signUp: the
 * only identity-creating path is POST /api/invitations/accept, which requires
 * an unexpired, unspent invitation whose digest matches the token below.
 */
interface SignupFormProps {
  invitationCode: string | null;
}

export default function SignupForm({ invitationCode }: SignupFormProps) {
  const [code, setCode] = useState(invitationCode ?? '');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !email.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code.trim(), email: email.trim() }),
      });
      const contentType = res.headers.get('content-type');
      const data = contentType?.includes('application/json')
        ? await res.json()
        : { error: 'Could not process this invitation. Please try again.' };

      if (!res.ok) {
        setError(
          typeof data?.error === 'string' && data.error
            ? data.error
            : 'Could not process this invitation. Please try again.',
        );
        return;
      }
      setSent(true);
    } catch {
      setError('Could not process this invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="panel p-6 sm:p-8 md:p-10">
        <div className="text-center py-6">
          <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans mb-1">
            Check your email
          </h2>
          <p className="text-sm text-text-muted">
            We sent a confirmation link to <strong className="text-text-primary">{email}</strong>.
            Open it to finish setting up your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-[2rem] sm:text-[2.25rem] font-semibold text-text-primary tracking-[-0.03em] font-sans leading-tight">
          {APP_NAME}
        </h1>
        <p className="text-sm sm:text-base text-text-muted mt-2">Accept your invitation</p>
        <p className="text-xs text-text-muted mt-1">
          Accounts are created by invitation from your institution administrator.
        </p>
      </div>

      <div className="panel p-6 sm:p-8 md:p-10">
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          <FormField
            id="invitationCode"
            label="Invitation code"
            type="text"
            value={code}
            onChange={setCode}
            placeholder="Paste the code from your invitation email"
            autoComplete="one-time-code"
            required
          />
          <FormField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@hospital.org"
            autoComplete="email"
            required
          />

          {error && <ErrorDisplay message={error} />}

          <button
            type="submit"
            disabled={!code.trim() || !email.trim() || loading}
            className="w-full py-3 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            {loading ? 'Checking invitation...' : 'Accept invitation'}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-text-muted mt-6 sm:mt-8">
        Already have an account?{' '}
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center font-medium text-primary hover:opacity-80 transition-opacity"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
