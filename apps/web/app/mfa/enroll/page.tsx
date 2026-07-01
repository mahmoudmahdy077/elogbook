'use client';

import { createClient } from '@/lib/supabase/client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import ErrorDisplay from '@/components/ErrorDisplay';

export default function MfaEnrollPage() {
  return (
    <Suspense fallback={<MfaEnrollFallback />}>
      <MfaEnrollInner />
    </Suspense>
  );
}

function MfaEnrollFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
      <div className="w-full max-w-md panel p-8">
        <h1 className="text-2xl font-heading font-bold text-center">Set up MFA</h1>
        <p className="text-sm text-neutral-light/60 text-center mt-4">Loading…</p>
      </div>
    </div>
  );
}

function MfaEnrollInner() {
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
        setError('Unable to start MFA enrollment. Please try again.');
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
      setError('Failed to start verification. Please try again.');
      setLoading(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: qr.factorId,
      code,
    });
    if (verifyError) {
      setError('Invalid verification code. Please check and re-enter.');
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
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-lg">
                <QRCodeSVG value={qr.uri} size={200} />
              </div>
              <p className="text-xs text-neutral-light/50">Scan with your authenticator app</p>
              <details className="text-xs text-neutral-light/50 w-full">
                <summary>Can&apos;t scan? Enter manually</summary>
                <code className="block mt-2 p-2 bg-neutral-dark rounded text-xs break-all">{qr.secret}</code>
              </details>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light text-sm"
            />
            {error && <ErrorDisplay message={error} />}
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
