'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
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

interface GatewayConfig {
  id: string;
  tenant_id: string;
  provider: string;
  publishable_key: string;
  has_secret_key: boolean;
  has_webhook_secret: boolean;
  endpoint_url: string | null;
  is_active: boolean;
}

interface PaymentGatewayPanelProps {
  tenantId: string;
  config: GatewayConfig | null;
}

const PROVIDERS = [
  { key: 'stripe', label: 'Stripe' },
  { key: 'paddle', label: 'Paddle' },
  { key: 'lemonsqueezy', label: 'LemonSqueezy' },
  { key: 'custom', label: 'Custom' },
];

export default function PaymentGatewayPanel({ tenantId, config }: PaymentGatewayPanelProps) {
  const router = useRouter();

  const [provider, setProvider] = useState(config?.provider ?? 'stripe');
  const [publishableKey, setPublishableKey] = useState(config?.publishable_key ?? '');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [endpointUrl, setEndpointUrl] = useState(config?.endpoint_url ?? '');
  const [isActive, setIsActive] = useState(config?.is_active ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSave() {
    setError('');
    setSuccess('');

    if (!publishableKey.trim()) {
      setError('Publishable Key is required.');
      return;
    }
    if (!config && !secretKey.trim()) {
      setError('Secret Key is required for new configuration.');
      return;
    }
    if (!config && !webhookSecret.trim()) {
      setError('Webhook Secret is required for new configuration.');
      return;
    }

    setLoading(true);

    const payload: Record<string, unknown> = {
      provider,
      publishable_key: publishableKey.trim(),
      is_active: isActive,
    };

    if (secretKey.trim()) {
      payload.secret_key = secretKey.trim();
    }
    if (webhookSecret.trim()) {
      payload.webhook_secret = webhookSecret.trim();
    }
    if (provider === 'custom') {
      payload.endpoint_url = endpointUrl.trim() || null;
    } else {
      payload.endpoint_url = null;
    }

    try {
      const res = await fetch(`/api/${tenantId}/admin/payment-gateway`, {
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

      setSuccess('Payment gateway configuration saved successfully.');
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
        <h2 className="text-lg font-semibold">Payment Gateway Configuration</h2>
      </Card.Header>
      <Card.Content className="gap-4">
        {error && <ErrorDisplay message={error} />}
        {success && (
          <div className="bg-success-50 text-success p-3 rounded-lg text-sm">{success}</div>
        )}

        <Select
          selectedKey={provider}
          onSelectionChange={(value) => {
            if (value) setProvider(String(value));
          }}
        >
          <Select.Trigger aria-label="Select payment provider"><Select.Value /></Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Select payment provider">
              {PROVIDERS.map((p) => (
                <ListBoxItem key={p.key} id={p.key}>{p.label}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <TextField
          value={publishableKey}
          onChange={setPublishableKey}
          isRequired={!config}
        >
          <Label>Publishable Key</Label>
          <Input placeholder="pk_..." />
        </TextField>

        <TextField
          type="password"
          value={secretKey}
          onChange={setSecretKey}
        >
          <Label>Secret Key</Label>
          <Input placeholder={config?.has_secret_key ? '•••••••• (leave blank to keep existing)' : 'Enter secret key'} />
        </TextField>

        <TextField
          type="password"
          value={webhookSecret}
          onChange={setWebhookSecret}
        >
          <Label>Webhook Secret</Label>
          <Input placeholder={config?.has_webhook_secret ? '•••••••• (leave blank to keep existing)' : 'Enter webhook secret'} />
        </TextField>

        {provider === 'custom' && (
          <TextField
            value={endpointUrl}
            onChange={setEndpointUrl}
          >
            <Label>Custom Endpoint URL</Label>
            <Input placeholder="https://api.example.com/payments" />
          </TextField>
        )}

        <div className="flex items-center gap-2">
          <Switch isSelected={isActive} onChange={setIsActive}>
            Enable Payments
          </Switch>
        </div>

        <Button variant="primary" onPress={handleSave} isDisabled={loading}>
          Save Configuration
        </Button>
      </Card.Content>
    </Card>
  );
}