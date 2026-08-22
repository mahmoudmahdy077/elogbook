'use client';

import { useState, useCallback } from 'react';

type Scope = 'stop' | 'elogbook' | 'supabase' | 'full';

export default function UninstallPage() {
  const [scope, setScope] = useState<Scope>('stop');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUninstall = useCallback(async () => {
    if (confirm !== 'DELETE') return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, confirm }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uninstall failed');
    } finally {
      setLoading(false);
    }
  }, [scope, confirm]);

  return (
    <div className="panel p-6 sm:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-danger">Uninstall Wizard</h1>

      <div className="space-y-4 mb-6">
        <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer">
          <input type="radio" name="scope" value="stop" checked={scope === 'stop'} onChange={() => setScope('stop')} />
          <div>
            <span className="font-semibold">Stop Services</span>
            <p className="text-sm text-text-muted">Stop all containers. Data is preserved.</p>
          </div>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer">
          <input type="radio" name="scope" value="elogbook" checked={scope === 'elogbook'} onChange={() => setScope('elogbook')} />
          <div>
            <span className="font-semibold">Remove E-Logbook</span>
            <p className="text-sm text-text-muted">Remove E-Logbook containers, images, and config. Supabase stays.</p>
          </div>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer">
          <input type="radio" name="scope" value="supabase" checked={scope === 'supabase'} onChange={() => setScope('supabase')} />
          <div>
            <span className="font-semibold">Remove Supabase</span>
            <p className="text-sm text-text-muted">Remove Supabase containers, images, and data. E-Logbook stays.</p>
          </div>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer">
          <input type="radio" name="scope" value="full" checked={scope === 'full'} onChange={() => setScope('full')} />
          <div>
            <span className="font-semibold text-danger">Full Removal</span>
            <p className="text-sm text-text-muted">Remove everything. This cannot be undone.</p>
          </div>
        </label>
      </div>

      <div className="mb-6">
        <label className="block text-xs mb-1">Type DELETE to confirm</label>
        <input value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border" placeholder="DELETE" />
      </div>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}
      {result && <p className="text-success text-sm mb-4">{result}</p>}

      <button onClick={handleUninstall} disabled={loading || confirm !== 'DELETE'} className="px-6 py-2 rounded-lg bg-danger text-white disabled:opacity-50">
        {loading ? 'Processing...' : 'Execute Uninstall'}
      </button>
    </div>
  );
}
