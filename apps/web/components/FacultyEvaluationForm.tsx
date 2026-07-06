'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface FacultyEvaluationFormProps {
  residentId: string;
  tenantId: string;
  evaluatorId: string;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5];

export default function FacultyEvaluationForm({ residentId, tenantId, evaluatorId }: FacultyEvaluationFormProps) {
  const supabase = createClient();
  const [clinicalSkills, setClinicalSkills] = useState(3);
  const [professionalism, setProfessionalism] = useState(3);
  const [procedures, setProcedures] = useState(3);
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('faculty_evaluations').insert({
      tenant_id: tenantId,
      resident_id: residentId,
      evaluator_id: evaluatorId,
      clinical_skills: clinicalSkills,
      professionalism: professionalism,
      procedures: procedures,
      comments: comments || null,
    });
    setSaving(false);
    if (insertError) setError(insertError.message);
    else {
      setComments('');
    }
  };

  return (
    <div className="panel p-6 space-y-4">
      {error && <ErrorDisplay message={error} />}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">Clinical Skills (1-5)</label>
        <select
          value={String(clinicalSkills)}
          onChange={(e) => setClinicalSkills(Number(e.target.value))}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          aria-label="Clinical skills rating"
        >
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">Professionalism (1-5)</label>
        <select
          value={String(professionalism)}
          onChange={(e) => setProfessionalism(Number(e.target.value))}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          aria-label="Professionalism rating"
        >
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">Procedures (1-5)</label>
        <select
          value={String(procedures)}
          onChange={(e) => setProcedures(Number(e.target.value))}
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          aria-label="Procedures rating"
        >
          {RATING_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-text-secondary block mb-1">Comments</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Optional feedback"
          className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
          rows={3}
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
        Submit Evaluation
      </button>
    </div>
  );
}
