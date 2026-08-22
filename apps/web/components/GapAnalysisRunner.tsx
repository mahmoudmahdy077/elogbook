'use client';

import { useState } from 'react';

interface GapResult {
  competency: string;
  current: number;
  target: number;
  gap: number;
  recommendation: string;
}

interface ResidentOption {
  id: string;
  full_name: string;
}

/** Competency gap-analysis runner (director+): pick a resident, call the
 *  gap-analysis API (proxies the ai-gap-analysis edge function), render
 *  gaps with recommendations. */
export default function GapAnalysisRunner({
  tenantSlug,
  residents,
}: {
  tenantSlug: string;
  residents: ResidentOption[];
}) {
  const [residentId, setResidentId] = useState(residents[0]?.id ?? '');
  const [results, setResults] = useState<GapResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/${tenantSlug}/reports/gap-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resident_id: residentId }),
      });
      const data = (await res.json()) as { gaps?: GapResult[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResults(Array.isArray(data.gaps) ? data.gaps : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap analysis failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans mb-1">
        Competency Gap Analysis
      </h2>
      <p className="text-sm text-text-muted mb-4">
        Compare a resident&apos;s case volume against ACGME minimums with recommendations.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={residentId}
          onChange={(e) => setResidentId(e.target.value)}
          className="px-3 py-2 rounded-full bg-white border border-border text-sm text-text-secondary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 max-w-[260px]"
        >
          {residents.length === 0 && <option value="">No residents</option>}
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || !residentId}
          className="px-4 py-2 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {results && (
        <div className="mt-4 space-y-3">
          {results.length === 0 ? (
            <p className="text-sm text-text-muted">No measurable gaps found.</p>
          ) : (
            results.map((g) => {
              const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
              const behind = g.gap > 0;
              return (
                <div key={g.competency}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-text-secondary font-medium truncate pr-2">
                      {g.competency}
                      {behind && <span className="text-danger font-semibold ml-2">−{g.gap}</span>}
                    </span>
                    <span className="text-text-muted font-medium tabular-nums">
                      {g.current}/{g.target}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-black/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${behind ? 'bg-warning' : 'bg-success'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted mt-1">{g.recommendation}</p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
