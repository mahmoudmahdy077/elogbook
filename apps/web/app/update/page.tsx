'use client';

import { useState, useEffect, useCallback } from 'react';

interface UpdateInfo {
  component: string;
  current_version: string;
  available_version: string;
  changelog?: string;
}

export default function UpdatePage() {
  const [loading, setLoading] = useState(true);
  const [updates, setUpdates] = useState<{ elogbook: UpdateInfo | null; supabase: UpdateInfo | null }>({ elogbook: null, supabase: null });
  const [selected, setSelected] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/update/check')
      .then(r => r.json())
      .then(data => { setUpdates(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const handleUpdate = useCallback(async () => {
    if (selected.length === 0) return;
    setUpdating(true);
    setError(null);

    try {
      const component = selected.length === 2 ? 'both' : selected[0];
      const res = await fetch('/api/update/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  }, [selected]);

  if (loading) return <div className="p-8 text-center">Checking for updates...</div>;

  const hasUpdates = updates.elogbook || updates.supabase;

  return (
    <div className="panel p-6 sm:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Update Wizard</h1>

      {!hasUpdates && !result && (
        <p className="text-text-muted">Your system is up to date.</p>
      )}

      {updates.elogbook && (
        <div className="p-4 rounded-lg border border-border mb-4">
          <div className="flex items-center justify-between">
            <div>
              <input type="checkbox" checked={selected.includes('elogbook')} onChange={e => setSelected(prev => e.target.checked ? [...prev, 'elogbook'] : prev.filter(s => s !== 'elogbook'))} className="mr-2" />
              <span className="font-semibold">E-Logbook</span>
            </div>
            <span className="text-sm text-text-muted">{updates.elogbook.current_version} → {updates.elogbook.available_version}</span>
          </div>
          {updates.elogbook.changelog && <p className="text-sm text-text-muted mt-2 ml-6">{updates.elogbook.changelog.slice(0, 200)}...</p>}
        </div>
      )}

      {updates.supabase && (
        <div className="p-4 rounded-lg border border-border mb-4">
          <div className="flex items-center justify-between">
            <div>
              <input type="checkbox" checked={selected.includes('supabase')} onChange={e => setSelected(prev => e.target.checked ? [...prev, 'supabase'] : prev.filter(s => s !== 'supabase'))} className="mr-2" />
              <span className="font-semibold">Supabase</span>
            </div>
            <span className="text-sm text-text-muted">{updates.supabase.current_version} → {updates.supabase.available_version}</span>
          </div>
        </div>
      )}

      {error && <p className="text-danger text-sm mb-4">{error}</p>}
      {result && <p className="text-success text-sm mb-4">{result}</p>}

      {hasUpdates && (
        <button onClick={handleUpdate} disabled={updating || selected.length === 0} className="px-6 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
          {updating ? 'Updating...' : `Update Selected (${selected.length})`}
        </button>
      )}
    </div>
  );
}
