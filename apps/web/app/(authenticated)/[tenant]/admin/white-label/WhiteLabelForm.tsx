'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface Props {
  tenantSlug: string;
  tenantId: string;
  initialBranding: Record<string, string>;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export default function WhiteLabelForm({ tenantSlug, initialBranding }: Props) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initialBranding.logo_url ?? '');
  const [primaryColor, setPrimaryColor] = useState(initialBranding.primary_color ?? '#007AFF');
  const [footerText, setFooterText] = useState(initialBranding.footer_text ?? '');
  const [institutionName, setInstitutionName] = useState(initialBranding.institution_name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSuccess(null);

    if (logoUrl && !isValidUrl(logoUrl)) {
      setError('Logo URL must be a valid https:// URL');
      return;
    }
    if (primaryColor && !HEX_RE.test(primaryColor)) {
      setError('Primary color must be a hex color like #007AFF or #07F');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/branding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo_url: logoUrl.trim() || null,
          primary_color: primaryColor.trim() || null,
          footer_text: footerText.trim() || null,
          institution_name: institutionName.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuccess('Branding saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-5 space-y-4">
      <h2 className="text-base font-semibold">Branding Settings</h2>
      {error && <ErrorDisplay message={error} />}
      {success && <div className="bg-success/10 text-success p-3 rounded-lg text-sm">{success}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium block mb-1">Logo URL</label>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
          <p className="text-xs text-text-muted mt-1">HTTPS URL to your logo. Upload roadmap: direct storage upload.</p>
          {logoUrl && isValidUrl(logoUrl) && (
            <div className="mt-2 p-2 border border-border rounded-lg bg-white flex items-center justify-center h-16">
              <img src={logoUrl} alt="Logo preview" className="max-h-12 max-w-full object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Primary Color</label>
          <div className="flex gap-2">
            <input
              type="color"
              value={HEX_RE.test(primaryColor) ? primaryColor : '#007AFF'}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-11 w-11 p-1 rounded-lg border border-border cursor-pointer"
              aria-label="Pick primary color"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#007AFF"
              className="flex-1 rounded-xl bg-neutral-dark border border-border p-3 text-sm font-mono"
            />
          </div>
          <div className="mt-2 h-2 rounded-full border border-border" style={{ background: HEX_RE.test(primaryColor) ? primaryColor : '#e5e7eb' }} />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Institution Display Name</label>
          <input
            type="text"
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            placeholder="Johns Hopkins"
            maxLength={80}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Footer Text</label>
          <input
            type="text"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Powered by E-Logbook"
            maxLength={120}
            className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={loading}
        className={`rounded-full bg-primary text-white px-5 py-2.5 text-sm font-medium transition-opacity ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
      >
        {loading ? 'Saving…' : 'Save Branding'}
      </button>
    </div>
  );
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
