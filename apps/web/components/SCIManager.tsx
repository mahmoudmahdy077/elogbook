'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface ScimToken {
  id: string;
  tenant_id: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface SCIManagerProps {
  tenantId: string;
  tenantSlug: string;
  initialTokens: ScimToken[];
  initialScimUrl: string;
}

export default function SCIManager({
  tenantId,
  tenantSlug: _tenantSlug,
  initialTokens,
  initialScimUrl,
}: SCIManagerProps) {
  const router = useRouter();
  const [tokens, setTokens] = useState<ScimToken[]>(initialTokens);
  const [scimUrl] = useState(initialScimUrl);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Generated token once — shown in a banner after creation
  const [newTokenPlaintext, setNewTokenPlaintext] = useState('');

  // Generate form
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Copied state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Clear success/error after timeout
  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => {
        setSuccess('');
        setError('');
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  // Clear newTokenPlaintext after 2 minutes
  useEffect(() => {
    if (newTokenPlaintext) {
      const t = setTimeout(() => setNewTokenPlaintext(''), 120_000);
      return () => clearTimeout(t);
    }
  }, [newTokenPlaintext]);

  const resetForm = useCallback(() => {
    setShowGenerateForm(false);
    setFormDescription('');
    setFormLoading(false);
    setFormError('');
  }, []);

  async function refreshTokens() {
    try {
      const res = await fetch(`/api/${tenantId}/admin/scim`);
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens ?? []);
      }
    } catch {
      // silent
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    setFormLoading(true);
    try {
      const res = await fetch(`/api/${tenantId}/admin/scim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: formDescription.trim() || null }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || 'Failed to generate token');
        setFormLoading(false);
        return;
      }

      setNewTokenPlaintext(data.plaintext);
      setSuccess('SCIM token generated successfully. Copy it now — it won\'t be shown again.');
      resetForm();
      await refreshTokens();
      router.refresh();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRevoke(token: ScimToken) {
    if (!confirm(`Revoke this SCIM token${token.description ? ` ("${token.description}")` : ''}? Any IdP using it will immediately lose access.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/${tenantId}/admin/scim?id=${token.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setTokens((prev) =>
          prev.map((t) =>
            t.id === token.id
              ? { ...t, revoked_at: new Date().toISOString() }
              : t,
          ),
        );
        setSuccess('Token revoked successfully.');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to revoke token');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
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

  const activeTokens = tokens.filter((t) => !t.revoked_at);
  const revokedTokens = tokens.filter((t) => t.revoked_at);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SCIM Provisioning</h2>
          <p className="text-sm text-text-muted mt-1">
            System for Cross-domain Identity Management — automate user provisioning from Okta,
            Microsoft Entra ID, JumpCloud, or any SCIM 2.0-compatible IdP.
          </p>
        </div>
        <div className="flex gap-3">
          {!showGenerateForm && (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowGenerateForm(true);
              }}
              className="rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              Generate Token
            </button>
          )}
        </div>
      </div>

      {error && <ErrorDisplay message={error} />}
      {success && (
        <div className="bg-[rgba(52,199,89,0.10)] text-[#34C759] p-3 rounded-lg text-sm">{success}</div>
      )}

      {/* ── New token plaintext banner ── */}
      {newTokenPlaintext && (
        <div className="bg-[rgba(0,122,255,0.10)] border border-[rgba(0,122,255,0.25)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#007AFF] mb-1">
                ⚠️ Token generated — copy it now
              </p>
              <p className="text-xs text-text-muted mb-3">
                This is the only time the plaintext token will be shown. Paste it into your IdP
                configuration immediately.
              </p>
              <div className="flex items-center gap-3">
                <code className="block bg-neutral-dark rounded-xl px-4 py-3 text-sm font-mono break-all select-all border border-border">
                  {newTokenPlaintext}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(newTokenPlaintext, '__new__')}
                  className="shrink-0 rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {copiedId === '__new__' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewTokenPlaintext('')}
              className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
              aria-label="Dismiss"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Provisioning Instructions ── */}
      <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
        <h3 className="text-base font-semibold mb-4">Provisioning Instructions</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
              SCIM Base URL
            </p>
            <div className="flex items-center gap-2">
              <code className="block bg-neutral-dark rounded-lg px-3 py-2 text-sm font-mono break-all border border-border flex-1">
                {scimUrl || '—'}
              </code>
              {scimUrl && (
                <button
                  type="button"
                  onClick={() => handleCopy(scimUrl, '__scim_url__')}
                  className="shrink-0 rounded-full bg-primary text-text-on-primary px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {copiedId === '__scim_url__' ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
              Authorization Header Format
            </p>
            <code className="block bg-neutral-dark rounded-lg px-3 py-2 text-sm font-mono border border-border">
              Authorization: Bearer {'{your_scim_token}'}
            </code>
            <p className="text-xs text-text-muted/50 mt-1">
              The SCIM endpoint accepts <strong>only</strong> bearer tokens generated below. Tokens are
              stored as SHA-256 hashes; the plaintext is shown exactly once at creation.
            </p>
          </div>
        </div>
      </div>

      {/* ── Generate Form ── */}
      {showGenerateForm && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-base font-semibold mb-4">Generate New SCIM Token</h3>

          <form onSubmit={handleGenerate} className="space-y-5">
            {formError && (
              <div className="bg-[rgba(255,69,58,0.10)] text-[#FF453A] p-3 rounded-lg text-sm">{formError}</div>
            )}

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Okta production, Entra ID dev"
                className="w-full rounded-xl bg-neutral-dark border border-border p-3 text-sm outline-none focus:border-primary transition-colors"
              />
              <p className="text-xs text-text-muted/50 mt-1">
                A friendly label to help identify what this token is used for.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={formLoading}
                className={`rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity ${
                  formLoading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                {formLoading ? 'Generating…' : 'Generate Token'}
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

      {/* ── Active Tokens ── */}
      {activeTokens.length > 0 && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-base font-semibold mb-4">
            Active Tokens <span className="text-text-muted font-normal text-sm">({activeTokens.length})</span>
          </h3>
          <div className="space-y-3">
            {activeTokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between border border-border rounded-xl p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#34C759]" title="Active" />
                    <span className="text-sm font-medium truncate">
                      {token.description || 'Unnamed token'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted mt-1">
                    <span>Created {formatDate(token.created_at)}</span>
                    {token.last_used_at ? (
                      <span>Last used {formatDate(token.last_used_at)}</span>
                    ) : (
                      <span className="text-text-muted/40">Never used</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    type="button"
                    onClick={() => handleCopy(token.id, token.id)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-neutral-dark transition-colors"
                  >
                    {copiedId === token.id ? 'Copied ID!' : 'Copy ID'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(token)}
                    className="rounded-full border border-[#FF453A] text-[#FF453A] px-3 py-1.5 text-xs font-medium hover:bg-[rgba(255,69,58,0.08)] transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Revoked Tokens ── */}
      {revokedTokens.length > 0 && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="text-base font-semibold mb-4">
            Revoked Tokens <span className="text-text-muted font-normal text-sm">({revokedTokens.length})</span>
          </h3>
          <div className="space-y-3">
            {revokedTokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between border border-border rounded-xl p-4 opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#FF453A]" title="Revoked" />
                    <span className="text-sm font-medium truncate line-through">
                      {token.description || 'Unnamed token'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted mt-1">
                    <span>Created {formatDate(token.created_at)}</span>
                    <span>Revoked {formatDate(token.revoked_at)}</span>
                    {token.last_used_at && <span>Last used {formatDate(token.last_used_at)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {tokens.length === 0 && !showGenerateForm && (
        <div className="bg-white dark:bg-neutral-dark rounded-2xl border border-border p-8 shadow-sm text-center">
          <div className="text-3xl mb-3">🔑</div>
          <h3 className="text-base font-semibold mb-1">No SCIM tokens yet</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Generate a token to configure SCIM provisioning with your identity provider.
            The token is shown once — copy it immediately into your IdP configuration.
          </p>
          <button
            type="button"
            onClick={() => setShowGenerateForm(true)}
            className="mt-4 rounded-full bg-primary text-text-on-primary px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Generate First Token
          </button>
        </div>
      )}
    </div>
  );
}
