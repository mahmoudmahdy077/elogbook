'use client';

import { useState } from 'react';
import ErrorDisplay from '@/components/ErrorDisplay';
import { createClient } from '@/lib/supabase/client';

interface QualityScores {
  completeness: number;
  specificity: number;
  classification: number;
  overall: number;
}

interface AIQualityPanelProps {
  tenantId: string;
  caseEntryId: string;
  viewerRole: string;
}

const QUALITY_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'];

const SCORE_LABELS: { key: keyof QualityScores; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'completeness', label: 'Completeness' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'classification', label: 'Classification' },
];

function friendlyError(message: string): string {
  if (message.includes('No active AI configuration')) {
    return 'This tenant has no active AI configuration yet. A tenant admin needs to configure an AI provider first.';
  }
  if (message.includes('Case must be deidentified') || message.includes('Case contains potential PHI')) {
    return 'This case cannot be scored: only de-identified cases without PHI are eligible for AI quality checks.';
  }
  if (message.includes('Insufficient permissions')) {
    return 'AI quality checks require a supervisor role or higher.';
  }
  if (message.includes('Case entry not found')) {
    return 'Case not found (it may have been deleted).';
  }
  if (message.includes('AI provider error') || message.includes('Failed to parse AI response')) {
    return 'The AI provider call failed. Please try again later.';
  }
  return message;
}

export default function AIQualityPanel({ tenantId, caseEntryId, viewerRole }: AIQualityPanelProps) {
  const [result, setResult] = useState<{
    scores: QualityScores;
    suggestions: string[];
    analyzed_fields: number;
    missing_fields: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!QUALITY_ROLES.includes(viewerRole)) return null;

  async function handleScore() {
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke('ai-quality', {
        body: { case_entry_id: caseEntryId, tenant_id: tenantId },
      });

      if (invokeError) {
        setError(friendlyError(invokeError.message ?? 'Failed to run AI quality check'));
        setLoading(false);
        return;
      }

      const payload = data as {
        scores?: QualityScores;
        suggestions?: string[];
        analyzed_fields?: number;
        missing_fields?: string[];
      };

      if (!payload?.scores) {
        setError(friendlyError('Failed to parse AI response'));
        setLoading(false);
        return;
      }

      setResult({
        scores: payload.scores,
        suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
        analyzed_fields: payload.analyzed_fields ?? 0,
        missing_fields: Array.isArray(payload.missing_fields) ? payload.missing_fields : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }

    setLoading(false);
  }

  return (
    <div className="panel">
      <div className="pb-4 border-b border-border">
        <h2 className="text-lg font-semibold">AI Quality Check</h2>
        <p className="text-sm text-text-muted">
          Supervisor AI assessment of this de-identified case entry.
        </p>
      </div>
      <div className="pt-4">
        {error && (
          <div className="mb-4">
            <ErrorDisplay message={error} />
          </div>
        )}

        <button
          type="button"
          onClick={handleScore}
          disabled={loading}
          className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {loading ? 'Analyzing…' : 'Run AI Quality Check'}
        </button>

        {loading && (
          <p className="text-sm text-text-muted mt-3" role="status">
            The AI provider may take up to 30 seconds.
          </p>
        )}

        {result && !loading && (
          <div className="mt-4 space-y-4" aria-live="polite">
            <div className="grid grid-cols-2 gap-3">
              {SCORE_LABELS.map(({ key, label }) => (
                <div key={key} className="bg-backdrop rounded-xl border border-border px-3.5 py-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
                  <p className="text-xl font-semibold text-text-primary tabular-nums">{result.scores[key]}</p>
                </div>
              ))}
            </div>

            <dl>
              <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Analyzed fields</dt>
              <dd className="text-sm text-text-primary">{result.analyzed_fields}</dd>
            </dl>

            {result.missing_fields.length > 0 && (
              <dl>
                <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Missing required fields</dt>
                <dd>
                  <ul className="list-disc list-inside text-sm text-text-secondary">
                    {result.missing_fields.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </dd>
              </dl>
            )}

            {result.suggestions.length > 0 && (
              <dl>
                <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Suggestions</dt>
                <dd>
                  <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                    {result.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </dd>
              </dl>
            )}

            {result.suggestions.length === 0 && result.missing_fields.length === 0 && (
              <div className="bg-success/10 border border-success/30 text-fg-success text-sm rounded-lg p-3">
                No issues found. The AI had no improvement suggestions for this entry.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
