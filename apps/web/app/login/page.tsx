'use client';

import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleOtpLogin = async () => {
    setError('');
    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const redirectTo = next
      ? `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${location.origin}/auth/callback`;
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setSent(true);
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
    } else {
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      location.href = next || '/dashboard';
    }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (password) {
      handlePasswordLogin();
    } else {
      handleOtpLogin();
    }
  };

  const buttonLabel = password ? 'Sign In' : 'Send Magic Link';

  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
      <div className="w-full max-w-md panel p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-heading font-bold mb-1">E-Logbook</h1>
          <p className="text-sm text-neutral-light/50">Sign in to your account</p>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <p className="text-emerald-400 font-medium">Check your email for a magic link!</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@hospital.org"
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light placeholder:text-neutral-light/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary-glow text-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for magic link"
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light placeholder:text-neutral-light/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary-glow text-sm"
              />
            </div>
            <p className="text-xs text-neutral-light/50">
              Leave the password field empty to receive a magic link via email.
            </p>

            {error && (
              <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!email || loading}
              className="w-full py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
            >
              {loading ? 'Signing in...' : buttonLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
