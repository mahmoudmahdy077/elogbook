'use client';

import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import { denyConsent as webDenyConsent, grantConsent as webGrantConsent } from '@/lib/analytics';

export default function ConsentRow({
  consentType,
  label,
  description,
  granted: initialGranted,
  tenantId,
  userId,
}: {
  consentType: string;
  label: string;
  description: string;
  granted: boolean;
  tenantId: string;
  userId: string;
}) {
  const router = useRouter();
  const [granted, setGranted] = useState<boolean>(initialGranted);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>('');
  const supabase = createClient();

  const handleToggle = async () => {
    setError('');
    const newValue = !granted;
    startTransition(async () => {
      const rpcResult = await supabase.rpc('set_user_consent' as never, {
        p_tenant_id: tenantId,
        p_consent_type: consentType,
        p_grant: newValue,
      } as never).then(
        (r: { data: unknown; error: { message: string } | null }) => ({ data: r.data, error: r.error }),
        (e: Error) => ({ data: null, error: e })
      );
      const rpcError = rpcResult.error;

      if (rpcError) {
        // Fallback: write directly (RPC may be missing on older deploys).
        const { error: insertError } = await supabase
          .from('consent_records')
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            consent_type: consentType,
            revoked_at: newValue ? null : new Date().toISOString(),
            version: '1.0',
          });
        if (insertError) {
          setError(insertError.message);
          return;
        }
      }

      // Side effects specific to certain consent types:
      if (consentType === 'analytics') {
        if (newValue) await webGrantConsent();
        else await webDenyConsent();
      }

      setGranted(newValue);
      router.refresh();
    });
  };

  return (
    <div className="panel p-4 flex items-start gap-4">
      <div className="flex-1">
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-xs text-text-muted mt-1">{description}</p>
        {error && <ErrorDisplay message={error} />}
      </div>
      <button
        onClick={handleToggle}
        disabled={pending}
        aria-pressed={granted}
        aria-label={`${granted ? 'Revoke' : 'Grant'} ${label} consent`}
        className={
          'px-3 py-1.5 rounded-lg text-xs font-medium ' +
          (granted
            ? 'bg-success/10 text-success border border-success/20'
            : 'bg-neutral-dark/50 text-text-secondary/90 border border-border')
        }
      >
        {pending ? '…' : granted ? 'Granted' : 'Not granted'}
      </button>
    </div>
  );
}
