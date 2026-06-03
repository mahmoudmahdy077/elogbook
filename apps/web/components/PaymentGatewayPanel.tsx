'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Input,
  Select,
  SelectItem,
  Switch,
  Card,
  CardBody,
  CardHeader,
} from '@heroui/react';
import type { Selection } from '@heroui/react';
import { createClient } from '@/lib/supabase/client';

interface GatewayConfig {
  id: string;
  tenant_id: string;
  provider: string;
  publishable_key: string;
  encrypted_secret_key: string;
  encrypted_webhook_secret: string;
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
    const supabase = createClient();

    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      provider,
      publishable_key: publishableKey.trim(),
      is_active: isActive,
    };

    if (secretKey.trim()) {
      payload.encrypted_secret_key = secretKey.trim();
    }
    if (webhookSecret.trim()) {
      payload.encrypted_webhook_secret = webhookSecret.trim();
    }
    if (provider === 'custom') {
      payload.endpoint_url = endpointUrl.trim() || null;
    } else {
      payload.endpoint_url = null;
    }

    if (config?.id) {
      const { error: updateError } = await supabase
        .from('payment_gateway_config')
        .update(payload)
        .eq('id', config.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('payment_gateway_config')
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    setSuccess('Payment gateway configuration saved successfully.');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Payment Gateway Configuration</h2>
      </CardHeader>
      <CardBody className="gap-4">
        {error && (
          <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-success-50 text-success p-3 rounded-lg text-sm">{success}</div>
        )}

        <Select
          label="Provider"
          selectedKeys={new Set([provider])}
          onSelectionChange={(keys: Selection) => {
            const value = Array.from(keys)[0] as string;
            if (value) setProvider(value);
          }}
        >
          {PROVIDERS.map((p) => (
            <SelectItem key={p.key}>{p.label}</SelectItem>
          ))}
        </Select>

        <Input
          label="Publishable Key"
          value={publishableKey}
          onValueChange={setPublishableKey}
          isRequired={!config}
        />

        <Input
          label="Secret Key"
          type="password"
          value={secretKey}
          onValueChange={setSecretKey}
          placeholder={config ? 'Leave blank to keep existing' : 'Enter secret key'}
        />

        <Input
          label="Webhook Secret"
          type="password"
          value={webhookSecret}
          onValueChange={setWebhookSecret}
          placeholder={config ? 'Leave blank to keep existing' : 'Enter webhook secret'}
        />

        {provider === 'custom' && (
          <Input
            label="Custom Endpoint URL"
            value={endpointUrl}
            onValueChange={setEndpointUrl}
            placeholder="https://api.example.com/payments"
          />
        )}

        <div className="flex items-center gap-2">
          <Switch isSelected={isActive} onValueChange={setIsActive}>
            Enable Payments
          </Switch>
        </div>

        <Button color="primary" onPress={handleSave} isLoading={loading}>
          Save Configuration
        </Button>
      </CardBody>
    </Card>
  );
}
