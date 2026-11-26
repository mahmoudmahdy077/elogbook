'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError('Could not update your password. The reset link may have expired — request a new one.');
      return;
    }

    router.replace('/login?reset=success');
  };

  return (
    <main id="main-content" className="min-h-screen flex items-center justify-center bg-surface px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface-solid rounded-2xl border border-border p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold text-text-primary">Choose a new password</h1>
        <p className="text-sm text-text-muted">
          You followed a password reset link. Set a new password for your account.
        </p>

        <div className="space-y-1">
          <label htmlFor="new-password" className="text-sm font-medium text-text-primary">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="confirm-password" className="text-sm font-medium text-text-primary">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-fg-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password || !confirm}
          className="w-full rounded-full bg-fg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </main>
  );
}
