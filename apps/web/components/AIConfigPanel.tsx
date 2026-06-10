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
} from '@heroui/react';
import { createClient } from '@/lib/supabase/client';

interface AIConfigData {
  id: string;
  tenant_id: string;
  provider: string;
  model: string;
  encrypted_api_key: string;
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
    const supabase = createClient();

    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      provider,
      model: model.trim(),
      is_active: isActive,
    };

    if (apiKey.trim()) {
      payload.encrypted_api_key = apiKey.trim();
    }
    if (provider === 'custom') {
      payload.endpoint_url = endpointUrl.trim() || null;
    } else {
      payload.endpoint_url = null;
    }

    if (config?.id) {
      const { error: updateError } = await supabase
        .from('ai_config')
        .update(payload)
        .eq('id', config.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('ai_config')
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    setSuccess('AI configuration saved successfully.');
    router.refresh();
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
          label="Provider"
          selectedKey={provider}
          onSelectionChange={(value) => {
            if (value) setProvider(value);
          }}
        >
          <Select.Trigger aria-label="Select AI provider"><Select.Value /></Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Select AI provider">
              {PROVIDERS.map((p) => (
                <ListBoxItem id={p.key}>{p.label}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <TextField
          label="Model"
          value={model}
          onChange={setModel}
          isRequired
          placeholder={DEFAULT_MODELS[provider] ?? 'Enter model name'}
        />

        <TextField
          label="API Key"
          type="password"
          value={apiKey}
          onChange={setApiKey}
          placeholder={config ? 'Leave blank to keep existing' : 'Enter API key'}
        />

        {provider === 'custom' && (
          <TextField
            label="Endpoint URL"
            value={endpointUrl}
            onChange={setEndpointUrl}
            placeholder="https://api.example.com/v1"
          />
        )}

        <div className="flex items-center gap-2">
          <Switch isSelected={isActive} onValueChange={setIsActive}>
            Enable AI Insights
          </Switch>
        </div>

        <Button color="primary" onPress={handleSave} isLoading={loading}>
          Save Configuration
        </Button>
      </Card.Content>
    </Card>
  );
}
