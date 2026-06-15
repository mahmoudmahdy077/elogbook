'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Modal,
  Button,
  TextField,
  TextArea,
  Select,
  ListBox,
  ListBoxItem,
  useOverlayState,
  Label,
  Input,
} from '@heroui/react';
import { programGoalSchema } from '@elogbook/shared';
import { createClient } from '@/lib/supabase/client';

interface GoalFormProps {
  tenantId: string;
  directorId: string;
  residents: { id: string; full_name: string }[];
}

export default function GoalForm({ tenantId, directorId, residents }: GoalFormProps) {
  const router = useRouter();
  const overlay = useOverlayState({ defaultOpen: false });

  const [residentId, setResidentId] = useState('');
  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setResidentId('');
    setTitle('');
    setTargetCount('');
    setSpecialty('');
    setDeadline('');
    setDescription('');
    setError('');
  }

  async function handleSubmit(onClose: () => void) {
    setError('');

    const result = programGoalSchema.safeParse({
      resident_id: residentId,
      title,
      target_count: Number(targetCount),
      specialty: specialty || null,
      deadline,
      description: description || null,
    });

    if (!result.success) {
      setError(result.error.issues.map((e) => e.message).join(', '));
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data: goal, error: insertError } = await supabase
      .from('program_goals')
      .insert({
        tenant_id: tenantId,
        director_id: directorId,
        resident_id: result.data.resident_id,
        title: result.data.title,
        target_count: result.data.target_count,
        specialty: result.data.specialty ?? null,
        deadline: result.data.deadline,
        description: result.data.description ?? null,
      })
      .select('id')
      .single();

    if (insertError || !goal) {
      setError(insertError?.message ?? 'Failed to create goal');
      setLoading(false);
      return;
    }

    const { error: progressError } = await supabase
      .from('goal_progress')
      .insert({
        goal_id: goal.id,
        resident_id: result.data.resident_id,
        current_count: 0,
      });

    if (progressError) {
      setError(progressError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    resetForm();
    router.refresh();
    overlay.close();
  }

  return (
    <>
      <Button onPress={overlay.open} variant="primary">New Goal</Button>
      <Modal.Root isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
        <Modal.Header>Create Goal</Modal.Header>
        <Modal.Body>
          {error && (
            <div className="text-danger text-sm bg-danger-50 p-2 rounded">{error}</div>
          )}
          <Select
            selectedKey={residentId || null}
            onSelectionChange={(key) => {
              if (key) setResidentId(String(key));
            }}
            isRequired
          >
            <Label>Resident</Label>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox aria-label="Select resident">
                {residents.map((r) => (
                  <ListBoxItem key={r.id} id={r.id}>{r.full_name}</ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField
            value={title}
            onChange={setTitle}
            isRequired
          >
            <Label>Title</Label>
            <Input placeholder="e.g. Complete 50 appendectomies" />
          </TextField>
          <TextField
            type="number"
            value={targetCount}
            onChange={setTargetCount}
            isRequired
          >
            <Label>Target Count</Label>
            <Input placeholder="50" />
          </TextField>
          <TextField
            value={specialty}
            onChange={setSpecialty}
          >
            <Label>Specialty</Label>
            <Input placeholder="e.g. General Surgery" />
          </TextField>
          <TextField
            type="date"
            value={deadline}
            onChange={setDeadline}
            isRequired
          >
            <Label>Deadline</Label>
            <Input />
          </TextField>
          <Label>Description</Label>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onPress={overlay.close}>Cancel</Button>
          <Button
            variant="primary"
            onPress={() => handleSubmit(overlay.close)}
            isDisabled={loading}
          >
            Create
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </>
  );
}
