'use client';

import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function MfaEnrollPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [qr, setQr] = useState<{ uri: string; secret: string; factorId: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const next = params.get('next') ?? '/dashboard';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      });
      if (cancelled) return;
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setQr({
        uri: data.totp.uri,
        secret: data.totp.secret,
        factorId: data.id,
      });
    })();
    return () => { cancelled = true; };
  }, [supabase.auth.mfa]);

  const handleVerify = async () => {
    if (!qr) return;
    setError('');
    setLoading(true);
    const { error: challengeError } = await supabase.auth.mfa.challenge({ factorId: qr.factorId });
    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: qr.factorId,
      code,
    });
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
        <h1 className="text-2xl font-heading font-bold text-center">Set up MFA</h1>
        <p className="text-sm text-neutral-light/60 text-center">
          Scan this URI in your authenticator app, then enter the 6-digit code.
        </p>
        {qr ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-neutral-dark p-3 break-all text-xs font-mono">{qr.uri}</div>
            <p className="text-xs text-neutral-light/50">
              Secret (if you cannot scan): <code>{qr.secret}</code>
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
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
          <p className="text-sm text-neutral-light/50">Generating QR…</p>
        )}
      </div>
    </div>
  );
}
