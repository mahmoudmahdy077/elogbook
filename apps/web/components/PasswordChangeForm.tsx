'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

const passwordSchema = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

interface PasswordChangeFormProps {
  onSaved: () => void;
  onCancel: () => void;
}

export default function PasswordChangeForm({ onSaved, onCancel }: PasswordChangeFormProps) {
  const supabase = createClient();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (!passwordSchema.test(newPassword)) {
      setError('Password must be at least 8 characters with an uppercase letter, a number, and a special character');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      setNewPassword('');
      setConfirmPassword('');
      onSaved();
    }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorDisplay message={error} />}
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">New Password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Confirm Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
        />
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
          {saving ? 'Changing…' : 'Change Password'}
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
