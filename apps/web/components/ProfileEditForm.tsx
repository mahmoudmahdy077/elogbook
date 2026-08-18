'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

const SPECIALTIES = [
  { value: 'surgery', label: 'Surgery' },
  { value: 'internal_medicine', label: 'Internal Medicine' },
  { value: 'pediatrics', label: 'Pediatrics' },
  { value: 'orthopedics', label: 'Orthopedics' },
  { value: 'radiology', label: 'Radiology' },
  { value: 'emergency_medicine', label: 'Emergency Medicine' },
  { value: 'family_medicine', label: 'Family Medicine' },
  { value: 'other', label: 'Other' },
];

interface ProfileEditFormProps {
  profileId: string;
  initialFullName: string;
  initialSpecialty: string | null;
  onSaved: (updated: { full_name: string; specialty: string | null }) => void;
  onCancel: () => void;
}

export default function ProfileEditForm({
  profileId,
  initialFullName,
  initialSpecialty,
  onSaved,
  onCancel,
}: ProfileEditFormProps) {
  const supabase = createClient();
  const [fullName, setFullName] = useState(initialFullName);
  const [specialty, setSpecialty] = useState(initialSpecialty ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), specialty: specialty || null })
      .eq('id', profileId);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      onSaved({ full_name: fullName.trim(), specialty: specialty || null });
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorDisplay message={error} />}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Full Name</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Specialty</label>
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          aria-label="Specialty"
        >
          <option value="">Select specialty</option>
          {SPECIALTIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
            saving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
          }`}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-neutral-dark border border-border px-4 py-2.5 text-sm font-medium hover:bg-neutral transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
