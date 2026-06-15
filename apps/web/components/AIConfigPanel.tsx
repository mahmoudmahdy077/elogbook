'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  TextField,
  Select,
  ListBox,
  ListBoxItem,
  Switch,
  Card,
  Label,
  Input,
} from '@heroui/react';

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

const PROVIDERS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'azure', label: 'Azure' },
  { key: 'openrouter', label: 'OpenRouter' },
  { key: 'custom', label: 'Custom' },
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
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Card.Header>
        <h2 className="text-lg font-semibold">AI Configuration</h2>
      </Card.Header>
      <Card.Content className="gap-4">
        {error && (
          <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-success-50 text-success p-3 rounded-lg text-sm">{success}</div>
        )}

        <Select
          selectedKey={provider}
          onSelectionChange={(value) => {
            if (value) setProvider(String(value));
          }}
        >
          <Select.Trigger aria-label="Select AI provider"><Select.Value /></Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Select AI provider">
              {PROVIDERS.map((p) => (
                <ListBoxItem key={p.key} id={p.key}>{p.label}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <TextField
          value={model}
          onChange={setModel}
          isRequired
        >
          <Label>Model</Label>
          <Input placeholder={DEFAULT_MODELS[provider] ?? 'Enter model name'} />
        </TextField>

        <TextField
          type="password"
          value={apiKey}
          onChange={setApiKey}
        >
          <Label>API Key</Label>
          <Input placeholder={config?.has_key ? 'sk-•••••••• (leave blank to keep existing)' : 'Enter API key'} />
        </TextField>

        {provider === 'custom' && (
          <TextField
            value={endpointUrl}
            onChange={setEndpointUrl}
          >
            <Label>Endpoint URL</Label>
            <Input placeholder="https://api.example.com/v1" />
          </TextField>
        )}

        <div className="flex items-center gap-2">
          <Switch isSelected={isActive} onChange={setIsActive}>
            Enable AI Insights
          </Switch>
        </div>

        <Button variant="primary" onPress={handleSave} isDisabled={loading}>
          Save Configuration
        </Button>
      </Card.Content>
    </Card>
  );
}