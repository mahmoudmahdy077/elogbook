'use client';

import { useState, useEffect, useCallback } from 'react';

interface BackupManifest {
  backup_id: string;
  type: string;
  trigger: string;
  created_at: string;
  size_bytes: number;
  contents: Record<string, boolean>;
  database_stats: Record<string, number>;
}

export default function BackupSettingsPage() {
  const [backups, setBackups] = useState<BackupManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    const res = await fetch('/api/backup');
    const data = await res.json();
    setBackups(data.backups || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const handleCreateBackup = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'manual' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult('Backup created successfully');
      loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }, [loadBackups]);

  const handleRestore = useCallback(async (backupId: string) => {
    setRestoring(backupId);
    setError(null);
    try {
      const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult('Restore completed successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setRestoring(null);
    }
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="panel p-6 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Backup & Restore</h1>

      <div className="mb-6">
        <button onClick={handleCreateBackup} disabled={creating} className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
          {creating ? 'Creating...' : 'Create Backup Now'}
        </button>
      </div>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}
      {result && <p className="text-success text-sm mb-4">{result}</p>}

      {loading ? <p>Loading backups...</p> : (
        <div className="space-y-3">
          {backups.length === 0 && <p className="text-text-muted">No backups found.</p>}
          {backups.map(b => (
            <div key={b.backup_id} className="flex items-center justify-between p-4 rounded-lg border border-border">
              <div>
                <span className="font-mono text-sm">{b.backup_id}</span>
                <span className="ml-2 text-xs text-text-muted">{b.trigger}</span>
                <span className="ml-2 text-xs text-text-muted">{formatSize(b.size_bytes)}</span>
              </div>
              <button onClick={() => handleRestore(b.backup_id)} disabled={restoring === b.backup_id} className="px-3 py-1 rounded text-sm border border-border hover:bg-neutral-dark">
                {restoring === b.backup_id ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
