'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface AIConfigData {
  id: string;
  tenant_id: string;
  provider: string;
  model: string;
  has_key: boolean;
  endpoint_url: string | null;
  is_active: boolean;
}

interface AIConfigPanelProps {
  tenantId: string;
  config: AIConfigData | null;
}

// P1.6: Custom provider disabled — only approved providers allowed
const PROVIDERS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'azure', label: 'Azure' },
  { key: 'openrouter', label: 'OpenRouter' },
];

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  azure: 'gpt-4',
  openrouter: 'openai/gpt-4o',
  custom: '',
};

export default function AIConfigPanel({ tenantId, config }: AIConfigPanelProps) {
  const router = useRouter();

  const [provider, setProvider] = useState(config?.provider ?? 'openai');
  const [model, setModel] = useState(config?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState(config?.endpoint_url ?? '');
  const [isActive, setIsActive] = useState(config?.is_active ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!config?.model) {
      setModel(DEFAULT_MODELS[provider] ?? '');
    }
  }, [provider, config]);

  async function handleSave() {
    setError('');
    setSuccess('');

    if (!model.trim()) {
      setError('Model is required.');
      return;
    }
    if (!config && !apiKey.trim()) {
      setError('API Key is required for new configuration.');
      return;
    }

    setLoading(true);

    const payload: Record<string, unknown> = {
      provider,
      model: model.trim(),
      is_active: isActive,
    };

    if (apiKey.trim()) {
      payload.api_key = apiKey.trim();
    }
    if (provider === 'custom') {
      payload.endpoint_url = endpointUrl.trim() || null;
    } else {
      payload.endpoint_url = null;
    }

    try {
      const res = await fetch(`/api/${tenantId}/admin/ai-config`, {
        method: config?.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save configuration.');
        setLoading(false);
        return;
      }

      setSuccess('AI configuration saved successfully.');
      router.refresh();
    } catch (_err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="pb-4 border-b border-border">
        <h2 className="text-lg font-semibold">AI Configuration</h2>
      </div>
      <div className="pt-4 space-y-4">
        {error && <ErrorDisplay message={error} />}
        {success && (
          <div className="bg-[rgba(52,199,89,0.10)] text-[#34C759] p-3 rounded-lg text-sm">{success}</div>
        )}

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">AI Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
            aria-label="Select AI provider"
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            required
            placeholder={DEFAULT_MODELS[provider] ?? 'Enter model name'}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.has_key ? 'sk-•••••••• (leave blank to keep existing)' : 'Enter API key'}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        {provider === 'custom' && (
          <div>
            <label className="text-sm font-medium text-text-secondary block mb-1">Endpoint URL</label>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
            />
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-default-300 rounded-full peer-checked:bg-primary transition-colors relative">
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </div>
          <span className="text-sm font-medium text-text-secondary">Enable AI Insights</span>
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
            loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
          }`}
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
}
