'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

const EVENT_TYPES = [
  { id: 'case.created', label: 'Case Created' },
  { id: 'case.updated', label: 'Case Updated' },
  { id: 'case.submitted', label: 'Case Submitted' },
  { id: 'case.approved', label: 'Case Approved' },
  { id: 'case.rejected', label: 'Case Rejected' },
  { id: 'case.deleted', label: 'Case Deleted' },
] as const;

type EventTypeId = (typeof EVENT_TYPES)[number]['id'];

interface Webhook {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  description: string | null;
  created_at: string;
  last_sent: string | null;
  last_status: number | null;
  last_succeeded: boolean | null;
}

interface WebhookManagerProps {
  tenantId: string;
  initialWebhooks: Webhook[];
}

export default function WebhookManager({ tenantId, initialWebhooks }: WebhookManagerProps) {
  const router = useRouter();
  const [webhooks, setWebhooks] = useState<Webhook[]>(initialWebhooks);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<EventTypeId[]>([]);
  const [formSecret, setFormSecret] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Testing state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Clear success/error after timeout
  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => { setSuccess(''); setError(''); }, 5000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setFormUrl('');
    setFormEvents([]);
    setFormSecret('');
    setFormDescription('');
    setFormActive(true);
    setFormLoading(false);
    setFormError('');
    setTestResult(null);
  }, []);

  const openEdit = useCallback((wh: Webhook) => {
    setEditingId(wh.id);
    setFormUrl(wh.url);
    setFormEvents(wh.events as EventTypeId[]);
    setFormSecret('');
    setFormDescription(wh.description ?? '');
    setFormActive(wh.is_active);
    setShowForm(true);
    setFormError('');
    setTestResult(null);
  }, []);

  function toggleEvent(evt: EventTypeId) {
    setFormEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    // Validation
    if (!formUrl.trim()) {
      setFormError('Webhook URL is required');
      return;
    }

    try {
      const parsed = new URL(formUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setFormError('URL must use http or https protocol');
        return;
      }
    } catch {
      setFormError('Invalid URL format');
      return;
    }

    if (formEvents.length === 0) {
      setFormError('Select at least one event type');
      return;
    }

    if (!editingId && !formSecret.trim()) {
      setFormError('Secret key is required (min 8 characters)');
      return;
    }

    if (formSecret.trim() && formSecret.trim().length < 8) {
      setFormError('Secret key must be at least 8 characters');
      return;
    }

    setFormLoading(true);

    try {
      const payload: Record<string, unknown> = {
        url: formUrl.trim(),
        events: formEvents,
        description: formDescription.trim() || null,
        is_active: formActive,
      };

      if (formSecret.trim()) {
        payload.secret = formSecret.trim();
      }

      const method = editingId ? 'PUT' : 'POST';
      if (editingId) {
        payload.id = editingId;
      }

      const res = await fetch(`/api/${tenantId}/admin/webhooks`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || 'Failed to save webhook');
        setFormLoading(false);
        return;
      }

      setSuccess(editingId ? 'Webhook updated successfully.' : 'Webhook created successfully.');
      resetForm();
      await refreshWebhooks();
      router.refresh();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setFormLoading(false);
    }
  }

  async function refreshWebhooks() {
    try {
      const res = await fetch(`/api/${tenantId}/admin/webhooks`);
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks ?? []);
      }
    } catch {
      // silent
    }
  }

  async function handleToggleActive(wh: Webhook) {
    try {
      const res = await fetch(`/api/${tenantId}/admin/webhooks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: wh.id, is_active: !wh.is_active }),
      });

      if (res.ok) {
        setWebhooks((prev) =>
          prev.map((w) => (w.id === wh.id ? { ...w, is_active: !wh.is_active } : w)),
        );
        setSuccess(`Webhook ${wh.is_active ? 'disabled' : 'enabled'} successfully.`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to toggle webhook');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  async function handleDelete(wh: Webhook) {
    if (!confirm(`Delete webhook "${wh.description || wh.url}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/${tenantId}/admin/webhooks?id=${wh.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== wh.id));
        setSuccess('Webhook deleted successfully.');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete webhook');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  async function handleTest(wh: Webhook) {
    setTestingId(wh.id);
    setTestResult(null);

    try {
      // Send test via the API, which will proxy to testWebhookEndpoint
      const res = await fetch(`/api/${tenantId}/admin/webhooks/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: wh.id }),
      });

      const data = await res.json();
      if (res.ok) {
        setTestResult(
          `Status ${data.status}: ${data.ok ? '✓ Success' : '✗ Failed'} — ${data.body?.slice(0, 300) || 'No response body'}`,
        );
      } else {
        setTestResult(`Error: ${data.error || 'Test request failed'}`);
      }
    } catch {
      setTestResult('Network error during test');
    } finally {
      setTestingId(null);
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Webhook Endpoints</h2>
          <p className="text-sm text-text-muted mt-1">
            Configure HTTP callbacks for case events. Max 10 webhooks per institution.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => { resetForm(); setShowForm(true); }}
            disabled={webhooks.length >= 10}
            className={`rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity ${
              webhooks.length >= 10 ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
          >
            Add Webhook
          </button>
        )}
      </div>

      {error && <ErrorDisplay message={error} />}
      {success && (
        <div className="bg-success/10 text-success p-3 rounded-lg text-sm">{success}</div>
      )}

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-base font-semibold mb-4">{editingId ? 'Edit Webhook' : 'New Webhook'}</h3>

          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div className="bg-danger/10 text-danger p-3 rounded-lg text-sm">{formError}</div>
            )}

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Webhook URL <span className="text-danger">*</span>
              </label>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://api.example.com/hooks/elogbook"
                className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                required
              />
              <p className="text-xs text-text-muted/50 mt-1">HTTPS is required in production.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Events <span className="text-danger">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {EVENT_TYPES.map((evt) => (
                  <label
                    key={evt.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                      formEvents.includes(evt.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-neutral-light/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formEvents.includes(evt.id)}
                      onChange={() => toggleEvent(evt.id)}
                      className="sr-only peer"
                    />
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                        formEvents.includes(evt.id)
                          ? 'bg-primary border-primary'
                          : 'border-neutral-light/30'
                      }`}
                    >
                      {formEvents.includes(evt.id) && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm">{evt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Secret Key <span className="text-danger">*</span>
              </label>
              <input
                type="password"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                placeholder={
                  editingId
                    ? 'Leave blank to keep existing secret'
                    : 'At least 8 characters'
                }
                className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                required={!editingId}
                minLength={8}
              />
              <p className="text-xs text-text-muted/50 mt-1">
                Used to sign payloads via HMAC-SHA256. Store this safely — it won&apos;t be shown again.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Slack notifications"
                className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-default-300 rounded-full peer-checked:bg-primary transition-colors relative">
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      formActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
              <span className="text-sm font-medium text-text-secondary">Active</span>
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={formLoading}
                className={`rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity ${
                  formLoading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                {formLoading ? 'Saving…' : editingId ? 'Update Webhook' : 'Create Webhook'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-text-secondary hover:bg-neutral-dark transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Webhook List ── */}
      {webhooks.length === 0 && !showForm ? (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-8 text-center">
          <div className="text-4xl mb-3 opacity-30">🔗</div>
          <p className="text-sm text-text-muted/70">No webhooks configured yet.</p>
          <p className="text-xs text-text-muted/50 mt-1">
            Add a webhook to receive case event notifications.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        wh.is_active ? 'bg-success' : 'bg-neutral-light/40'
                      }`}
                    />
                    <span className="text-sm font-medium truncate">
                      {wh.description || wh.url}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted/60 truncate font-mono">{wh.url}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {wh.events.map((evt) => (
                      <span
                        key={evt}
                        className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                      >
                        {evt}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-text-muted/50">
                    <span>Created {formatDate(wh.created_at)}</span>
                    {wh.last_sent && (
                      <span>
                        Last sent {formatDate(wh.last_sent)}
                        {wh.last_succeeded !== null && (
                          <span className={`ml-1 ${wh.last_succeeded ? 'text-success' : 'text-danger'}`}>
                            {wh.last_succeeded ? '✓' : '✗'}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleTest(wh)}
                    disabled={testingId === wh.id}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-neutral-dark transition-colors disabled:opacity-50"
                    title="Send test payload"
                  >
                    {testingId === wh.id ? 'Testing…' : 'Test'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleActive(wh)}
                    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                      wh.is_active ? 'bg-primary' : 'bg-default-300'
                    }`}
                    title={wh.is_active ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        wh.is_active ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => openEdit(wh)}
                    className="rounded-full border border-border p-1.5 hover:bg-neutral-dark transition-colors"
                    title="Edit"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(wh)}
                    className="rounded-full border border-border p-1.5 hover:bg-red-500/10 transition-colors"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              {testResult && testingId === null && (
                <div className={`mt-3 p-3 rounded-xl text-xs font-mono whitespace-pre-wrap ${
                  testResult.includes('✓') ? 'bg-success/10 text-success' :
                  testResult.startsWith('Status') ? 'bg-danger/10 text-danger' :
                  'bg-danger/10 text-danger'
                }`}>
                  {testResult}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
