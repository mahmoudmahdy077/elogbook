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

  const buttonLabel = password ? 'Sign In' : 'Send Magic Link';

  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
      <div className="w-full max-w-md panel p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-heading font-bold mb-1">{APP_NAME}</h1>
          <p className="text-sm text-text-muted">Sign in to your account</p>
        </div>

        {sent ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-success-50 text-success flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
            </div>
            <p className="text-success font-medium text-sm mb-1">Check your email!</p>
            <p className="text-xs text-text-muted">We sent a magic link to <strong>{email}</strong>. Click it to sign in.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Link
              href="/login/sso"
              className="w-full inline-block text-center py-2.5 rounded-lg border border-border bg-neutral-dark/50 text-text-primary font-medium text-sm hover:bg-neutral-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
            >
              Sign in with SSO
            </Link>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <hr className="flex-1 border-border" />
              <span>or</span>
              <hr className="flex-1 border-border" />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@hospital.org"
                required
                autoComplete="email"
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary-glow text-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                Password <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for magic link"
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary-glow text-sm"
              />
            </div>
            <p className="text-xs text-text-muted">
              Leave the password field empty to receive a magic link via email.
            </p>

            {error && (
              <div className="bg-danger-50 text-danger text-xs rounded-lg p-2.5 border border-danger/20" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email || loading}
              className="w-full py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow flex items-center justify-center gap-2"
            >
              {loading && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? 'Signing in...' : buttonLabel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
