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
  const [query, setQuery] = useState('');
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
          query: query.trim() || null,
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
    <div className="bg-white rounded-2xl border border-black/5 p-5 mt-6">
      <h2 className="text-lg font-semibold text-black tracking-[-0.02em] font-sans mb-4">AI Case Insights</h2>

      {error && (
        <div className="mb-4">
          <ErrorDisplay message={error} />
        </div>
      )}

      <label htmlFor="ai-query" className="block text-sm font-medium text-[#3C3C43] mb-1.5">
        Ask a question about your cases (optional)
      </label>
      <textarea
        id="ai-query"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={2}
        placeholder="e.g., What patterns do you see in my surgical cases?"
        className="w-full px-3.5 py-2.5 rounded-xl bg-[#F2F2F7] border border-black/5 text-black placeholder:text-[#8E8E93] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm transition-colors resize-none mb-4"
      />

      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {query.trim() ? 'Ask AI' : 'Analyze My Cases'}
      </button>

      {loading && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}

      {response && !loading && (
        <div className="mt-4 bg-[#F2F2F7] rounded-xl p-4 text-sm text-[#3C3C43] whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto border border-black/5">
          {response}
        </div>
      )}
    </div>
  );
}
