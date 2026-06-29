'use client';

import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function RetentionForm({ currentDays, tenantId }: { currentDays: number; tenantId: string }) {
  const router = useRouter();
  const [days, setDays] = useState<number>(currentDays);
  const [purge, setPurge] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult('');

    if (days < 365 || days > 3650) {
      setError('Retention window must be between 365 and 3650 days');
      return;
    }

    if (purge && !window.confirm(`Soft-delete cases older than ${days} days? This is irreversible from the UI.`)) {
      return;
    }

    startTransition(async () => {
      const { data, error: rpcError } = await supabase.rpc('set_data_retention', {
        p_tenant_id: tenantId,
        p_data_retention_days: days,
        p_purge_now: purge,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const r = data as { old_days?: number; new_days?: number; forecast_count?: number; purged?: number } | null;
      setResult(`Updated: ${r?.old_days} → ${r?.new_days} days${r?.purged ? ` (purged ${r.purged} cases)` : ''}.`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="panel p-4 space-y-4">
      <h2 className="text-sm font-medium">Update policy</h2>

      <div>
        <label htmlFor="days" className="block text-sm font-medium mb-1.5">
          Retention window (days)
        </label>
        <input
          id="days"
          type="number"
          min={365}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light text-sm"
        />
        <p className="text-xs text-neutral-light/50 mt-1">
          Allowed: 365–3650 days. HIPAA / GDPR / SCFHS reference: ≥ 1 year.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={purge}
          onChange={(e) => setPurge(e.target.checked)}
          className="rounded border-border bg-neutral-dark"
        />
        <span>Purge now (soft-delete entries older than the new window)</span>
      </label>

      {error && (
        <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>
      )}
      {result && (
        <div className="rounded-lg p-2.5 text-xs bg-emerald-900/20 text-emerald-300" role="status">{result}</div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Save policy'}
      </button>
    </form>
  );
}
