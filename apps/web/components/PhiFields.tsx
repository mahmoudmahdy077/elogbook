'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface PhiFieldsProps {
  mrn: string;
  dob: string;
  entryId: string;
  tenantId: string;
  userId: string;
}

export function PhiFields({ mrn, dob, entryId, tenantId, userId }: PhiFieldsProps) {
  const [mrnRevealed, setMrnRevealed] = useState(false);
  const [dobRevealed, setDobRevealed] = useState(false);

  const maskMrn = (val: string) => {
    if (val.length <= 4) return val;
    return '***-**-' + val.slice(-4);
  };

  const maskDob = (val: string) => {
    if (val.length <= 5) return val;
    return '****-**-' + val.slice(-2);
  };

  const reveal = async (field: 'mrn' | 'dob') => {
    const supabase = createClient();
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: userId,
      action: 'phi_view',
      resource_type: 'case_entry',
      resource_id: entryId,
      changes: {},
    });
    if (field === 'mrn') setMrnRevealed(true);
    else setDobRevealed(true);
  };

  return (
    <>
      <div>
        <label className="text-sm text-text-muted">Patient MRN</label>
        <div className="flex items-center gap-2">
          <p>{mrnRevealed ? mrn : maskMrn(mrn)}</p>
          {!mrnRevealed && (
            <button onClick={() => reveal('mrn')} className="text-xs text-primary hover:underline">
              Reveal
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="text-sm text-text-muted">Patient DOB</label>
        <div className="flex items-center gap-2">
          <p>{dobRevealed ? dob : maskDob(dob)}</p>
          {!dobRevealed && (
            <button onClick={() => reveal('dob')} className="text-xs text-primary hover:underline">
              Reveal
            </button>
          )}
        </div>
      </div>
    </>
  );
}
