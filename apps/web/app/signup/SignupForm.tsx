'use client';

import { createClient } from '@/lib/supabase/client';
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '@elogbook/shared';
import { FormField } from '@elogbook/shared/components/web';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';

function SuccessState({ email }: { email: string }) {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 rounded-full bg-success/10 border border-success/20 text-success flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans mb-1">Check your email</h2>
      <p className="text-sm text-text-muted">
        We sent a confirmation link to <strong className="text-text-primary">{email}</strong>.
      </p>
      <p className="text-xs text-text-muted mt-3">Click the link in the email to verify your account. The link expires in 1 hour.</p>
    </div>
  );
}

interface SignupFormProps {
  planSlug: string | null;
}

export default function SignupForm({ planSlug }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setLoading(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        data: { plan_slug: planSlug ?? undefined },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="panel p-6 sm:p-8 md:p-10">
        <SuccessState email={email} />
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-6 sm:mb-8">
        <h1 className="text-[2rem] sm:text-[2.25rem] font-semibold text-text-primary tracking-[-0.03em] font-sans leading-tight">{APP_NAME}</h1>
        <p className="text-sm sm:text-base text-text-muted mt-2">Create your account</p>
        {planSlug && (
          <p className="text-xs text-text-muted mt-1">
            Selected plan: <span className="font-medium text-text-primary capitalize">{planSlug}</span>
          </p>
        )}
      </div>

      <div className="panel p-6 sm:p-8 md:p-10">
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          <FormField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="doctor@hospital.org"
            autoComplete="email"
            required
          />
          <FormField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Create a password"
            autoComplete="new-password"
            required
          />

          {error && <ErrorDisplay message={error} />}

          <button
            type="submit"
            disabled={!email || !password || loading}
            className="w-full py-3 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center gap-2"
          >
            {loading ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <input type="hidden" name="plan" value={planSlug ?? ''} />
      </div>

      <p className="text-center text-sm text-text-muted mt-6 sm:mt-8">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:opacity-80 transition-opacity">
          Sign in
        </Link>
      </p>
    </div>
  );
}
