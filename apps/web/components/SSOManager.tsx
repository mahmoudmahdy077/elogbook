'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface SsoConfig {
  id: string;
  protocol: 'saml' | 'oidc';
  metadata_url: string | null;
  discovery_url: string | null;
  idp_entity_id: string | null;
  client_id: string | null;
  default_role: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

interface SSOManagerProps {
  tenantId: string;
  tenantSlug: string;
  initialConfigs: SsoConfig[];
}

const ALLOWED_ROLES = [
  { id: 'resident', label: 'Resident' },
  { id: 'supervisor', label: 'Supervisor' },
  { id: 'director', label: 'Director' },
  { id: 'institution_admin', label: 'Institution Admin' },
] as const;

type RoleId = (typeof ALLOWED_ROLES)[number]['id'];

export default function SSOManager({ tenantId, tenantSlug, initialConfigs }: SSOManagerProps) {
  const router = useRouter();
  const [configs, setConfigs] = useState<SsoConfig[]>(initialConfigs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formProtocol, setFormProtocol] = useState<'saml' | 'oidc'>('saml');
  const [formMetadataUrl, setFormMetadataUrl] = useState('');
  const [formDiscoveryUrl, setFormDiscoveryUrl] = useState('');
  const [formIdpEntityId, setFormIdpEntityId] = useState('');
  const [formIdpCertificate, setFormIdpCertificate] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formClientSecret, setFormClientSecret] = useState('');
  const [formDefaultRole, setFormDefaultRole] = useState<RoleId>('resident');
  const [formActive, setFormActive] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // ACS URL display
  const supabaseUrl = typeof window !== 'undefined'
    ? (window as { __NEXT_DATA__?: { env?: Record<string, string> } } as Record<string, unknown>)
    : null;
  const acsUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sso-callback`
    : '';

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
    setFormProtocol('saml');
    setFormMetadataUrl('');
    setFormDiscoveryUrl('');
    setFormIdpEntityId('');
    setFormIdpCertificate('');
    setFormClientId('');
    setFormClientSecret('');
    setFormDefaultRole('resident');
    setFormActive(true);
    setFormLoading(false);
    setFormError('');
  }, []);

  const openEdit = useCallback((cfg: SsoConfig) => {
    setEditingId(cfg.id);
    setFormProtocol(cfg.protocol);
    setFormMetadataUrl(cfg.metadata_url ?? '');
    setFormDiscoveryUrl(cfg.discovery_url ?? '');
    setFormIdpEntityId(cfg.idp_entity_id ?? '');
    setFormIdpCertificate('');
    setFormClientId(cfg.client_id ?? '');
    setFormClientSecret('');
    setFormDefaultRole(cfg.default_role as RoleId);
    setFormActive(cfg.is_active);
    setShowForm(true);
    setFormError('');
  }, []);

  function handleProtocolChange(protocol: 'saml' | 'oidc') {
    setFormProtocol(protocol);
    // Clear fields from the other protocol
    if (protocol === 'saml') {
      setFormDiscoveryUrl('');
      setFormClientId('');
      setFormClientSecret('');
    } else {
      setFormMetadataUrl('');
      setFormIdpEntityId('');
      setFormIdpCertificate('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    // Validation
    if (formProtocol === 'saml' && !formMetadataUrl.trim()) {
      setFormError('Metadata URL is required for SAML');
      return;
    }

    if (formProtocol === 'oidc' && !formDiscoveryUrl.trim()) {
      setFormError('Discovery URL is required for OIDC');
      return;
    }

    if (formProtocol === 'saml' && formMetadataUrl.trim()) {
      try {
        const parsed = new URL(formMetadataUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          setFormError('Metadata URL must use http or https protocol');
          return;
        }
      } catch {
        setFormError('Invalid Metadata URL format');
        return;
      }
    }

    if (formProtocol === 'oidc' && formDiscoveryUrl.trim()) {
      try {
        const parsed = new URL(formDiscoveryUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          setFormError('Discovery URL must use http or https protocol');
          return;
        }
      } catch {
        setFormError('Invalid Discovery URL format');
        return;
      }
    }

    setFormLoading(true);

    try {
      const payload: Record<string, unknown> = {
        protocol: formProtocol,
        default_role: formDefaultRole,
        is_active: formActive,
      };

      if (formProtocol === 'saml') {
        payload.metadata_url = formMetadataUrl.trim() || null;
        payload.idp_entity_id = formIdpEntityId.trim() || null;
        payload.idp_certificate = formIdpCertificate.trim() || null;
      } else {
        payload.discovery_url = formDiscoveryUrl.trim() || null;
        payload.client_id = formClientId.trim() || null;
        if (formClientSecret.trim()) {
          payload.client_secret = formClientSecret.trim();
        }
      }

      const method = editingId ? 'PUT' : 'POST';
      if (editingId) {
        payload.id = editingId;
      }

      const res = await fetch(`/api/${tenantId}/admin/sso`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || 'Failed to save SSO configuration');
        setFormLoading(false);
        return;
      }

      setSuccess(editingId ? 'SSO configuration updated successfully.' : 'SSO configuration created successfully.');
      resetForm();
      await refreshConfigs();
      router.refresh();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setFormLoading(false);
    }
  }

  async function refreshConfigs() {
    try {
      const res = await fetch(`/api/${tenantId}/admin/sso`);
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs ?? []);
      }
    } catch {
      // silent
    }
  }

  async function handleToggleActive(cfg: SsoConfig) {
    try {
      const res = await fetch(`/api/${tenantId}/admin/sso`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cfg.id, is_active: !cfg.is_active }),
      });

      if (res.ok) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === cfg.id ? { ...c, is_active: !cfg.is_active } : c)),
        );
        setSuccess(`SSO ${cfg.is_active ? 'disabled' : 'enabled'} successfully.`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to toggle SSO config');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  async function handleDelete(cfg: SsoConfig) {
    if (!confirm(`Delete this ${cfg.protocol.toUpperCase()} configuration? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/${tenantId}/admin/sso?id=${cfg.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setConfigs((prev) => prev.filter((c) => c.id !== cfg.id));
        setSuccess(`${cfg.protocol.toUpperCase()} configuration deleted successfully.`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete SSO config');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SSO Configuration</h2>
          <p className="text-sm text-text-muted mt-1">
            Configure SAML or OIDC single sign-on for your institution.
          </p>
        </div>
        {!showForm && configs.length < 2 && (
          <button
            type="button"
            onClick={() => { resetForm(); setShowForm(true); }}
            className="rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Add SSO Provider
          </button>
        )}
      </div>

      {error && <ErrorDisplay message={error} />}
      {success && (
        <div className="bg-[rgba(52,199,89,0.10)] text-[#34C759] p-3 rounded-lg text-sm">{success}</div>
      )}

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-base font-semibold mb-4">{editingId ? 'Edit SSO Configuration' : 'New SSO Configuration'}</h3>

          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div className="bg-[rgba(255,69,58,0.10)] text-[#FF453A] p-3 rounded-lg text-sm">{formError}</div>
            )}

            {/* Protocol selector */}
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Protocol <span className="text-[#FF453A]">*</span>
              </label>
              <div className="flex gap-3">
                {(['saml', 'oidc'] as const).map((p) => (
                  <label
                    key={p}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                      formProtocol === p
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-border hover:border-neutral-light/30 text-text-secondary'
                    }`}
                  >
                    <input
                      type="radio"
                      name="protocol"
                      value={p}
                      checked={formProtocol === p}
                      onChange={() => handleProtocolChange(p)}
                      className="sr-only peer"
                    />
                    <span className="text-sm">{p.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* SAML fields */}
            {formProtocol === 'saml' && (
              <>
                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    Metadata URL <span className="text-[#FF453A]">*</span>
                  </label>
                  <input
                    type="url"
                    value={formMetadataUrl}
                    onChange={(e) => setFormMetadataUrl(e.target.value)}
                    placeholder="https://idp.example.com/metadata.xml"
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                    required
                  />
                  <p className="text-xs text-text-muted/50 mt-1">
                    The IdP metadata endpoint that contains the SSO URL and certificate.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    IdP Entity ID
                  </label>
                  <input
                    type="text"
                    value={formIdpEntityId}
                    onChange={(e) => setFormIdpEntityId(e.target.value)}
                    placeholder="https://idp.example.com/entity-id"
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                  />
                  <p className="text-xs text-text-muted/50 mt-1">
                    Optional. The SAML entity ID of your identity provider.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    IdP Certificate
                  </label>
                  <textarea
                    value={formIdpCertificate}
                    onChange={(e) => setFormIdpCertificate(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                    rows={4}
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm font-mono outline-none focus:border-primary transition-colors resize-y"
                  />
                  <p className="text-xs text-text-muted/50 mt-1">
                    Optional. The IdP signing certificate for SAML response validation.
                  </p>
                </div>
              </>
            )}

            {/* OIDC fields */}
            {formProtocol === 'oidc' && (
              <>
                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    Discovery URL <span className="text-[#FF453A]">*</span>
                  </label>
                  <input
                    type="url"
                    value={formDiscoveryUrl}
                    onChange={(e) => setFormDiscoveryUrl(e.target.value)}
                    placeholder="https://idp.example.com/.well-known/openid-configuration"
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                    required
                  />
                  <p className="text-xs text-text-muted/50 mt-1">
                    The OIDC discovery endpoint that returns the provider configuration.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    placeholder="your-client-id"
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-text-secondary block mb-1.5">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={formClientSecret}
                    onChange={(e) => setFormClientSecret(e.target.value)}
                    placeholder={editingId ? 'Leave blank to keep existing' : 'Client secret'}
                    className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
                  />
                  <p className="text-xs text-text-muted/50 mt-1">
                    Stored encrypted at rest. Provide a new value only if rotating the secret.
                  </p>
                </div>
              </>
            )}

            {/* Default role */}
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Default Role
              </label>
              <select
                value={formDefaultRole}
                onChange={(e) => setFormDefaultRole(e.target.value as RoleId)}
                className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
              >
                {ALLOWED_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <p className="text-xs text-text-muted/50 mt-1">
                The default role assigned to users who sign in via this SSO provider.
              </p>
            </div>

            {/* Active toggle */}
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
                {formLoading ? 'Saving…' : editingId ? 'Update Configuration' : 'Create Configuration'}
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

          {/* ACS URL display */}
          {acsUrl && (
            <div className="mt-6 pt-5 border-t border-border">
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Assertion Consumer Service (ACS) URL
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-neutral-dark rounded-xl border border-border p-3 text-xs font-mono text-text-secondary break-all">
                  {acsUrl}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(acsUrl);
                    setSuccess('ACS URL copied to clipboard.');
                  }}
                  className="shrink-0 rounded-full border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-neutral-dark transition-colors"
                  title="Copy ACS URL"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-text-muted/50 mt-1">
                Provide this URL to your identity provider as the SAML/OIDC callback endpoint.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── SSO Config List ── */}
      {configs.length === 0 && !showForm ? (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-8 text-center">
          <div className="text-4xl mb-3 opacity-30">🔐</div>
          <p className="text-sm text-text-muted/70">No SSO configurations yet.</p>
          <p className="text-xs text-text-muted/50 mt-1">
            Add a SAML or OIDC provider to enable single sign-on for your institution.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        cfg.is_active ? 'bg-[#34C759]' : 'bg-neutral-light/40'
                      }`}
                    />
                    <span className="text-sm font-medium">
                      {cfg.protocol.toUpperCase()} Configuration
                    </span>
                  </div>

                  <div className="space-y-1 mt-2">
                    {cfg.metadata_url && (
                      <p className="text-xs text-text-muted/60 truncate">
                        <span className="font-medium text-text-secondary">Metadata:</span> {cfg.metadata_url}
                      </p>
                    )}
                    {cfg.discovery_url && (
                      <p className="text-xs text-text-muted/60 truncate">
                        <span className="font-medium text-text-secondary">Discovery:</span> {cfg.discovery_url}
                      </p>
                    )}
                    {cfg.idp_entity_id && (
                      <p className="text-xs text-text-muted/60 truncate">
                        <span className="font-medium text-text-secondary">Entity ID:</span> {cfg.idp_entity_id}
                      </p>
                    )}
                    {cfg.client_id && (
                      <p className="text-xs text-text-muted/60">
                        <span className="font-medium text-text-secondary">Client ID:</span> {cfg.client_id}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-2 text-xs text-text-muted/50">
                    <span>Role: <span className="font-medium text-text-secondary">{cfg.default_role}</span></span>
                    <span>Created {formatDate(cfg.created_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(cfg)}
                    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                      cfg.is_active ? 'bg-primary' : 'bg-default-300'
                    }`}
                    title={cfg.is_active ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        cfg.is_active ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => openEdit(cfg)}
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
                    onClick={() => handleDelete(cfg)}
                    className="rounded-full border border-border p-1.5 hover:bg-red-500/10 transition-colors"
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
