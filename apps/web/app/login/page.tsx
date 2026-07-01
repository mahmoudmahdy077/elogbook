'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { safeRelativePath } from '@/lib/safe-redirect';
import { APP_NAME } from '@elogbook/shared';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
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
      setError(otpError.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const handlePasswordLogin = async () => {
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
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

  return (
    <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/15 mb-4">
            <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">
            {APP_NAME}
          </h1>
          <p className="text-sm text-text-muted mt-1.5">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-surface-solid border border-border rounded-xl p-6 sm:p-8">
          {sent ? (
            <SuccessState email={email} />
          ) : (
            <div className="space-y-5">
              <Link
                href="/login/sso"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border bg-neutral-dark/30 text-text-primary font-medium text-sm hover:bg-neutral-dark/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                Sign in with SSO
              </Link>

              <Divider label="or continue with email" />

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="doctor@hospital.org"
                  autoComplete="email"
                  required
                />
                <Field
                  id="password"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <p className="text-xs text-text-muted -mt-1">
                  Leave blank to receive a magic link instead.
                </p>

                {error && (
                  <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg px-3 py-2" role="alert">
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
                  className="w-full py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow flex items-center justify-center gap-2"
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

        {/* Footer */}
        <p className="text-center text-xs text-text-muted mt-6">
          By signing in, you agree to your institution&apos;s data
          handling policy.
        </p>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted">
      <hr className="flex-1 border-border" />
      <span className="uppercase tracking-wide">{label}</span>
      <hr className="flex-1 border-border" />
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  id: string;
  label: React.ReactNode;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5 text-text-primary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-dark border border-border text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary-glow/50 text-sm transition-colors"
      />
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function SuccessState({ email }: { email: string }) {
  return (
    <div className="text-center py-4">
      <div className="w-12 h-12 rounded-full bg-success/15 border border-success/30 text-success flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
      <h2 className="text-lg font-heading font-semibold text-text-primary mb-2">Check your email</h2>
      <p className="text-sm text-text-muted">
        We sent a magic link to{' '}
        <strong className="text-text-primary font-medium">{email}</strong>.
      </p>
      <p className="text-xs text-text-muted mt-3">
        Click the link in the email to sign in. The link expires in 1 hour.
      </p>
    </div>
  );
}
