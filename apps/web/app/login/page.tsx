'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { APP_NAME } from '@elogbook/shared';
import { FormField, FormDivider, Spinner } from '@elogbook/shared/components/web';
import { safeRelativePath } from '@/lib/safe-redirect';

function EyeIcon() {
  return (
    <svg className="w-4 h-4 text-text-muted cursor-pointer hover:text-text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4 text-text-muted cursor-pointer hover:text-text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ForgotPasswordForm({ email, onBack }: { email: string; onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleReset = async () => {
    setError('');
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    if (resetError) {
      setError('Unable to send reset email. Please verify your email address.');
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <h2 className="text-lg font-heading font-semibold text-text-primary mb-2">Check your email</h2>
        <p className="text-sm text-text-muted">
          We sent password reset instructions to <strong className="text-text-primary">{email}</strong>.
        </p>
        <button onClick={onBack} className="mt-4 text-sm text-primary hover:underline">Back to sign in</button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-1">Reset password</h2>
      <p className="text-sm text-text-muted mb-4">Enter your email and we&apos;ll send you a reset link.</p>
      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-3 py-2 mb-4" role="alert">
          {error}
        </div>
      )}
      <button
        onClick={handleReset}
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Sending...' : 'Send reset link'}
      </button>
      <button onClick={onBack} className="mt-3 w-full text-sm text-text-muted hover:text-text-primary transition-colors">
        Back to sign in
      </button>
    </div>
  );
}

function SuccessState({ email }: { email: string }) {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 rounded-full bg-success/15 border border-success/30 text-success flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-1">Check your email</h2>
      <p className="text-sm text-text-muted">
        We sent a magic link to <strong className="text-text-primary">{email}</strong>.
      </p>
      <p className="text-xs text-text-muted mt-3">Click the link in the email to sign in. The link expires in 1 hour.</p>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  const handleOtpLogin = async () => {
    setError('');
    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    const next = safeRelativePath(params.get('next'));
    const redirectTo = next !== '/'
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/auth/callback`;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (otpError) {
      setError('Failed to send verification code. Please try again.');
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const handlePasswordLogin = async () => {
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Invalid email or password. Please try again.');
      setLoading(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const next = safeRelativePath(params.get('next'));
    if (next !== '/') {
      router.push(next);
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenants!inner(slug)')
      .eq('user_id', session?.user?.id ?? '')
      .single();
    const tenants = profile?.tenants as { slug: string } | null;
    router.push(tenants?.slug ? `/${tenants.slug}/dashboard` : '/dashboard');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password) {
      handlePasswordLogin();
    } else {
      handleOtpLogin();
    }
  };

  if (showForgot) {
    return (
      <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-surface-solid border border-border rounded-2xl p-6 sm:p-8">
            <ForgotPasswordForm email={email} onBack={() => setShowForgot(false)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4 landscape:overflow-y-auto landscape:items-start landscape:pt-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6 landscape:mb-4">
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-text-primary">{APP_NAME}</h1>
          <p className="text-sm text-text-muted mt-1">Sign in to your account</p>
        </div>

        <div className="bg-surface-solid border border-border rounded-2xl p-6 sm:p-8 landscape:p-4">
          {sent ? (
            <SuccessState email={email} />
          ) : (
            <div className="space-y-4 landscape:space-y-3">
              <Link
                href="/login/sso"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border bg-neutral-dark/30 text-text-primary font-medium text-sm hover:bg-neutral-dark/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow landscape:py-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                Sign in with SSO
              </Link>

              <FormDivider label="or continue with email" />

              <form onSubmit={handleSubmit} className="space-y-3 landscape:space-y-2">
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
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  }
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted">Leave blank to receive a magic link.</p>
                  <button
                    type="button"
                    onClick={() => setShowForgot(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                {error && (
                  <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-3 py-2" role="alert" aria-live="assertive" aria-atomic="true">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                      </svg>
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!email || loading}
                  className="w-full py-2.5 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow flex items-center justify-center gap-2 landscape:py-2"
                >
                  {loading ? <Spinner /> : null}
                  {loading
                    ? 'Signing in...'
                    : password
                    ? 'Sign in'
                    : 'Send magic link'}
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6 landscape:mt-4">
          By signing in, you agree to your institution&apos;s data handling policy.
        </p>
      </div>
    </div>
  );
}
