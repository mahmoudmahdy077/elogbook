'use client';

import { useState } from 'react';

interface PhiFieldsProps {
  /** Pre-masked by the server — the full value is never in the RSC payload. */
  mrnMasked: string;
  dobMasked: string;
  entryId: string;
  tenantSlug: string;
  /** False → de-identified or blank: nothing to reveal. */
  hasPhi: boolean;
}

/**
 * UX2-018: patient MRN / DOB are masked by default. Revealing requires an
 * explicit click, which POSTs to the audit-logged phi-reveal endpoint —
 * the audit row is written server-side before the values are returned.
 */
export function PhiFields({ mrnMasked, dobMasked, entryId, tenantSlug, hasPhi }: PhiFieldsProps) {
  const [mrn, setMrn] = useState<string | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revealed = mrn !== null || dob !== null;

  const reveal = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/${tenantSlug}/cases/${entryId}/phi-reveal`, { method: 'POST' });
      if (!res.ok) throw new Error(`reveal failed: ${res.status}`);
      const data = (await res.json()) as { mrn: string | null; dob: string | null };
      setMrn(data.mrn);
      setDob(data.dob);
    } catch {
      setError('Could not reveal — try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <dl>
        <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Patient MRN</dt>
        <dd className="text-text-primary">{mrn ?? mrnMasked}</dd>
      </dl>
      <dl>
        <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Patient DOB</dt>
        <dd className="text-text-primary">{dob ?? dobMasked}</dd>
      </dl>
      {hasPhi && !revealed && (
        <button
          type="button"
          onClick={reveal}
          disabled={loading}
          className="text-xs text-fg-primary hover:underline disabled:opacity-50"
        >
          {loading ? 'Revealing…' : 'Reveal PHI'}
        </button>
      )}
      {error && <p className="text-xs text-fg-danger">{error}</p>}
    </>
  );
}
