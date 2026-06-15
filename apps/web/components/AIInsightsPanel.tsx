'use client';

import { useState } from 'react';
import {
  Card,
  TextArea,
  Button,
  Spinner,
  Label,
} from '@heroui/react';
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
    <Card className="mt-6">
      <Card.Header>
        <h2 className="text-lg font-semibold">AI Case Insights</h2>
      </Card.Header>
      <Card.Content className="gap-4">
        {error && (
          <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm">{error}</div>
        )}

        <Label>Ask a question about your cases (optional)</Label>
        <TextArea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
        />

        <Button
          variant="primary"
          onPress={handleAnalyze}
          isDisabled={loading}
        >
          {query.trim() ? 'Ask AI' : 'Analyze My Cases'}
        </Button>

        {loading && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}

        {response && !loading && (
          <div className="bg-default-50 border border-default-200 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {response}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
