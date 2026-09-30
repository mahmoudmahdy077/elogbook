'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { recordPhiView } from '@/lib/audit/record-phi-view';

interface PhiFieldsProps {
  mrn: string;
  dob: string;
  entryId: string;
  tenantId: string;
}

export function PhiFields({ mrn, dob, entryId, tenantId }: PhiFieldsProps) {
  const [mrnRevealed, setMrnRevealed] = useState(false);
  const [dobRevealed, setDobRevealed] = useState(false);
  const [auditFailed, setAuditFailed] = useState(false);

  const maskMrn = (val: string | null) => {
    if (!val) return '—';
    if (val.length <= 4) return val;
    return '***-**-' + val.slice(-4);
  };

  const maskDob = (val: string | null) => {
    if (!val) return '—';
    if (val.length <= 5) return val;
    return '****-**-' + val.slice(-2);
  };

  // Fail closed: the value is only revealed once the disclosure is recorded
  // through the trusted audit path. A rejected audit write must not become an
  // unlogged PHI disclosure.
  const reveal = async (field: 'mrn' | 'dob') => {
    const recorded = await recordPhiView(createClient(), { entryId, tenantId, field });
    if (!recorded) {
      setAuditFailed(true);
      return;
    }
    if (field === 'mrn') setMrnRevealed(true);
    else setDobRevealed(true);
  };

  return (
    <>
      <div>
        <label className="text-sm text-text-muted">Patient MRN</label>
        <div className="flex items-center gap-2">
          <p>{mrnRevealed ? (mrn || '—') : maskMrn(mrn)}</p>
          {!mrnRevealed && mrn && (
            <button onClick={() => reveal('mrn')} className="text-xs text-fg-primary hover:underline">
              Reveal
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="text-sm text-text-muted">Patient DOB</label>
        <div className="flex items-center gap-2">
          <p>{dobRevealed ? (dob || '—') : maskDob(dob)}</p>
          {!dobRevealed && dob && (
            <button onClick={() => reveal('dob')} className="text-xs text-fg-primary hover:underline">
              Reveal
            </button>
          )}
        </div>
      </div>
      {auditFailed && (
        <p role="alert" className="text-xs text-danger-foreground">
          Could not record this access. The value stays hidden — try again.
        </p>
      )}
    </>
  );
}
