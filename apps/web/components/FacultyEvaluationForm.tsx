'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button, TextField, Label, Input, Select, ListBox, ListBoxItem } from '@heroui/react';
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
        <label className="block text-sm mb-2">Clinical Skills (1-5)</label>
        <Select selectedKey={String(clinicalSkills)} onSelectionChange={(k) => setClinicalSkills(Number(k))}>
          <Select.Trigger aria-label="Clinical skills rating">
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Rating options">
              {RATING_OPTIONS.map((r) => (
                <ListBoxItem key={r}>{r}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div>
        <label className="block text-sm mb-2">Professionalism (1-5)</label>
        <Select selectedKey={String(professionalism)} onSelectionChange={(k) => setProfessionalism(Number(k))}>
          <Select.Trigger aria-label="Professionalism rating">
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Rating options">
              {RATING_OPTIONS.map((r) => (
                <ListBoxItem key={r}>{r}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div>
        <label className="block text-sm mb-2">Procedures (1-5)</label>
        <Select selectedKey={String(procedures)} onSelectionChange={(k) => setProcedures(Number(k))}>
          <Select.Trigger aria-label="Procedures rating">
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Rating options">
              {RATING_OPTIONS.map((r) => (
                <ListBoxItem key={r}>{r}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <TextField value={comments} onChange={setComments}>
        <Label>Comments</Label>
        <Input placeholder="Optional feedback" />
      </TextField>
      <Button onPress={handleSave} isDisabled={saving} variant="primary">
        Submit Evaluation
      </Button>
    </div>
  );
}