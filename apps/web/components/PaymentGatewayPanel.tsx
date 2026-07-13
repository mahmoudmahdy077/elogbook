'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

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

// P1.5: Stripe-only until Paddle/LemonSqueezy have equivalent production support
const PROVIDERS = [
  { key: 'stripe', label: 'Stripe' },
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
    <div className="panel">
      <div className="pb-4 border-b border-border">
        <h2 className="text-lg font-semibold">Payment Gateway Configuration</h2>
      </div>
      <div className="pt-4 space-y-4">
        {error && <ErrorDisplay message={error} />}
        {success && (
          <div className="bg-[rgba(52,199,89,0.10)] text-[#34C759] p-3 rounded-lg text-sm">{success}</div>
        )}

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">Payment Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
            aria-label="Select payment provider"
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">Publishable Key</label>
          <input
            type="text"
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
            required={!config}
            placeholder="pk_..."
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">Secret Key</label>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={config?.has_secret_key ? '•••••••• (leave blank to keep existing)' : 'Enter secret key'}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary block mb-1">Webhook Secret</label>
          <input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={config?.has_webhook_secret ? '•••••••• (leave blank to keep existing)' : 'Enter webhook secret'}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        {provider === 'custom' && (
          <div>
            <label className="text-sm font-medium text-text-secondary block mb-1">Custom Endpoint URL</label>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.example.com/payments"
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
          <span className="text-sm font-medium text-text-secondary">Enable Payments</span>
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
