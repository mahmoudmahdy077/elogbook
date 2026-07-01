'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TextField, Select, ListBox, ListBoxItem, Label, Input, Button } from '@heroui/react';
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
      <TextField value={date} onChange={setDate} isRequired>
        <Label>Date</Label>
        <Input type="date" />
      </TextField>
      <TextField value={hours} onChange={setHours} isRequired>
        <Label>Hours Worked</Label>
        <Input type="number" step="0.25" placeholder="e.g. 8.5" />
      </TextField>
      <Select selectedKey={shiftType} onSelectionChange={(k) => setShiftType(String(k))}>
        <Select.Trigger aria-label="Shift type">
          <Select.Value />
        </Select.Trigger>
        <Select.Popover>
          <ListBox aria-label="Shift types">
            {SHIFT_OPTIONS.map((o) => (
              <ListBoxItem key={o.key}>{o.label}</ListBoxItem>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <TextField value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <Input placeholder="Optional notes" />
      </TextField>
      <Button onPress={handleSave} isDisabled={saving} variant="primary">
        Save Duty Hours
      </Button>
    </div>
  );
}