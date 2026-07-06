'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

const SHIFT_OPTIONS = [
  { key: 'call', label: 'Call' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'vacation', label: 'Vacation' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'regular', label: 'Regular' },
];

interface DutyHoursFormProps {
  residentId: string;
  tenantId: string;
}

export default function DutyHoursForm({ residentId, tenantId }: DutyHoursFormProps) {
  const supabase = createClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [shiftType, setShiftType] = useState('regular');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!hours || isNaN(Number(hours))) {
      setError('Invalid hours');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('duty_periods').insert({
      tenant_id: tenantId,
      resident_id: residentId,
      shift_date: date,
      hours_worked: Number(hours),
      shift_type: shiftType,
      notes: notes || null,
    });
    setSaving(false);
    if (insertError) setError(insertError.message);
    else {
      setHours('');
      setNotes('');
    }
  };

  return (
    <div className="panel p-6 space-y-4">
      {error && <ErrorDisplay message={error} />}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Hours Worked</label>
        <input
          type="number"
          step="0.25"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          required
          placeholder="e.g. 8.5"
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Shift Type</label>
        <select
          value={shiftType}
          onChange={(e) => setShiftType(e.target.value)}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          aria-label="Shift type"
        >
          {SHIFT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Notes</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
          saving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
        }`}
      >
        Save Duty Hours
      </button>
    </div>
  );
}
