'use client';

import { createClient } from '@/lib/supabase/client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Factor = { id: string; type: 'totp' };

export default function MfaVerifyPage() {
  return (
    <Suspense fallback={<MfaVerifyFallback />}>
      <MfaVerifyInner />
    </Suspense>
  );
}

function MfaVerifyFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
      <div className="w-full max-w-md panel p-8">
        <h1 className="text-2xl font-heading font-bold text-center">Verify with MFA</h1>
        <p className="text-sm text-neutral-light/60 text-center mt-4">Loading…</p>
      </div>
    </div>
  );
}

function MfaVerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const next = params.get('next') ?? '/dashboard';
  const [factor, setFactor] = useState<Factor | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) {
        setError(listError.message);
        return;
      }
      const totp = data?.totp?.[0];
      if (!totp) {
        router.replace(`/mfa/enroll?next=${encodeURIComponent(next)}`);
        return;
      }
      setFactor({ id: totp.id, type: 'totp' });
    })();
    return () => { cancelled = true; };
  }, [supabase.auth.mfa, router, next]);

  const handleVerify = async () => {
    if (!factor) return;
    setError('');
    setLoading(true);
    const { error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: factor.id, code });
    if (verifyError) {
      setError(verifyError.message);
      setLoading(false);
      return;
    }
    router.push(next);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
      <div className="w-full max-w-md panel p-8 space-y-4">
        <h1 className="text-2xl font-heading font-bold text-center">Verify with MFA</h1>
        <p className="text-sm text-neutral-light/60 text-center">
          Enter the 6-digit code from your authenticator app.
        </p>
        {factor ? (
          <div className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light text-sm"
            />
            {error && <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>}
            <button
              onClick={handleVerify}
              disabled={code.length < 6 || loading}
              className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-neutral-light/50">Checking factors…</p>
        )}
      </div>
    </div>
  );
}
