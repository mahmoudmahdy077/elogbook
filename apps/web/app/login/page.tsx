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
    <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4 sm:p-8 lg:p-16 landscape:overflow-y-auto landscape:items-start landscape:pt-4">
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-xl xl:max-w-2xl">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-10 lg:mb-12 landscape:mb-3">
          <div className="inline-flex items-center justify-center w-10 h-10 sm:w-14 sm:h-14 lg:w-16 lg:h-16 xl:w-20 xl:h-20 rounded-2xl bg-primary/15 mb-3 sm:mb-5 lg:mb-6 landscape:hidden">
            <svg className="w-5 h-5 sm:w-7 sm:h-7 lg:w-8 lg:h-8 xl:w-10 xl:h-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
          </div>
          <h1 className="text-xl sm:text-3xl lg:text-4xl xl:text-5xl font-heading font-bold text-text-primary landscape:text-lg">
            {APP_NAME}
          </h1>
          <p className="text-xs sm:text-sm lg:text-lg xl:text-xl text-text-muted mt-1 sm:mt-2 lg:mt-3 landscape:text-xs landscape:mt-0">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-surface-solid border border-border rounded-2xl p-5 sm:p-10 lg:p-12 xl:p-14 landscape:p-4">
          {sent ? (
            <SuccessState email={email} />
          ) : (
            <div className="space-y-4 sm:space-y-6 lg:space-y-8 xl:space-y-10 landscape:space-y-2">
              <Link
                href="/login/sso"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 sm:py-3 lg:py-3.5 xl:py-4 rounded-xl border border-border bg-neutral-dark/30 text-text-primary font-medium text-sm sm:text-base lg:text-lg xl:text-xl hover:bg-neutral-dark/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow landscape:py-2 landscape:text-xs"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                Sign in with SSO
              </Link>

              <Divider label="or continue with email" />

              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-5 lg:space-y-6 xl:space-y-7 landscape:space-y-2">
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
                <p className="text-xs sm:text-sm lg:text-base xl:text-lg text-text-muted -mt-1 sm:-mt-2 lg:-mt-3 landscape:-mt-1 landscape:text-\[10px\]">
                  Leave blank to receive a magic link instead.
                </p>

                {error && (
                  <div className="bg-danger/10 border border-danger/30 text-danger text-sm lg:text-lg xl:text-xl rounded-xl px-3 py-2 sm:px-5 sm:py-3 lg:px-6 lg:py-4 landscape:px-3 landscape:py-1.5 landscape:text-xs" role="alert">
                    <div className="flex items-start gap-2 lg:gap-3">
                      <svg className="w-4 h-4 lg:w-6 lg:h-6 xl:w-7 xl:h-7 flex-shrink-0 mt-0.5 landscape:w-3 landscape:h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                      </svg>
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!email || loading}
                  className="w-full py-2.5 sm:py-3 lg:py-4 xl:py-5 rounded-xl bg-primary text-white font-medium text-sm sm:text-base lg:text-lg xl:text-xl hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow flex items-center justify-center gap-2 landscape:py-2 landscape:text-xs"
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
        <p className="text-center text-xs sm:text-sm lg:text-base xl:text-lg text-text-muted mt-6 sm:mt-8 lg:mt-10 xl:mt-12 landscape:mt-4 landscape:text-\[10px\]">
          By signing in, you agree to your institution&apos;s data handling policy.
        </p>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4 lg:gap-5 text-xs sm:text-sm lg:text-base xl:text-lg text-text-muted landscape:gap-2 landscape:text-\[10px\]">
      <hr className="flex-1 border-border" />
      <span className="uppercase tracking-wide whitespace-nowrap">{label}</span>
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
      <label htmlFor={id} className="block text-xs sm:text-sm lg:text-lg xl:text-xl font-medium mb-1 sm:mb-2 text-text-primary landscape:text-\[10px\] landscape:mb-0.5">
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
        className="w-full px-3 sm:px-4 lg:px-5 xl:px-6 py-2.5 sm:py-3 lg:py-4 xl:py-5 rounded-xl bg-neutral-dark border border-border text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary-glow/50 text-sm sm:text-base lg:text-lg xl:text-xl transition-colors landscape:py-2 landscape:text-xs"
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
    <div className="text-center py-4 sm:py-8 lg:py-10 xl:py-12 landscape:py-3">
      <div className="w-10 h-10 sm:w-14 sm:h-14 lg:w-20 lg:h-20 xl:w-24 xl:h-24 rounded-full bg-success/15 border border-success/30 text-success flex items-center justify-center mx-auto mb-3 sm:mb-5 lg:mb-7 xl:mb-8 landscape:hidden">
        <svg className="w-5 h-5 sm:w-7 sm:h-7 lg:w-10 lg:h-10 xl:w-12 xl:h-12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="landscape:inline-flex landscape:items-center landscape:gap-2">
        <svg className="hidden landscape:inline-block w-4 h-4 text-success flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <h2 className="text-base sm:text-xl lg:text-2xl xl:text-3xl font-heading font-semibold text-text-primary mb-1 sm:mb-2 lg:mb-3 xl:mb-4 landscape:text-sm landscape:mb-0">Check your email</h2>
      </div>
      <p className="text-xs sm:text-sm lg:text-lg xl:text-xl text-text-muted landscape:text-xs">
        We sent a magic link to{' '}
        <strong className="text-text-primary font-medium">{email}</strong>.
      </p>
      <p className="text-xs sm:text-sm lg:text-base xl:text-lg text-text-muted mt-2 sm:mt-3 lg:mt-4 xl:mt-5 landscape:mt-1 landscape:text-\[10px\]">
        Click the link in the email to sign in. The link expires in 1 hour.
      </p>
    </div>
  );
}
