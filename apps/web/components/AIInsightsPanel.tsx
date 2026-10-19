'use client';

import { useState } from 'react';
import ErrorDisplay from '@/components/ErrorDisplay';
import { Spinner } from '@elogbook/shared/components/web';
import { createClient } from '@/lib/supabase/client';

interface AIInsightsPanelProps {
  tenantId: string;
  residentId: string;
}

export default function AIInsightsPanel({ tenantId, residentId }: AIInsightsPanelProps) {
  const [intent, setIntent] = useState<'overview' | 'trends' | 'development' | 'case-mix'>('overview');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAnalyze() {
    setError('');
    setResponse('');
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke('ai-insights', {
        body: {
          tenant_id: tenantId,
          resident_id: residentId,
          intent,
        },
      });

      if (invokeError) {
        setError(invokeError.message ?? 'Failed to get AI insights');
        setLoading(false);
        return;
      }

      setResponse((data as { response?: string })?.response ?? 'No response received.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }

    setLoading(false);
  }

  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-5 mt-6">
      <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans mb-4">AI Case Insights</h2>

      {error && (
        <div className="mb-4">
          <ErrorDisplay message={error} />
        </div>
      )}

      <label htmlFor="ai-intent" className="block text-sm font-medium text-text-secondary mb-1.5">
        Choose an analysis focus
      </label>
      <select
        id="ai-intent"
        value={intent}
        onChange={(event) => setIntent(event.target.value as typeof intent)}
        className="w-full px-3.5 py-2.5 rounded-xl bg-backdrop border border-border text-text-primary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-colors mb-4"
      >
        <option value="overview">Overall case overview</option>
        <option value="trends">Case trends</option>
        <option value="development">Development opportunities</option>
        <option value="case-mix">Case mix</option>
      </select>

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="inline-flex min-h-[44px] items-center gap-1.5 px-4 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Analyze My Cases
      </button>

      {loading && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}

      {response && !loading && (
        <div className="mt-4 bg-backdrop rounded-xl p-4 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto border border-border">
          {response}
        </div>
      )}
    </div>
  );
}
