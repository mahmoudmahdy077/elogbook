'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
  Select,
  SelectItem,
  useDisclosure,
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
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

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
      setError(result.error.errors.map((e) => e.message).join(', '));
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
    onClose();
  }

  return (
    <>
      <Button onPress={onOpen} color="primary">New Goal</Button>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Create Goal</ModalHeader>
              <ModalBody>
                {error && (
                  <div className="text-danger text-sm bg-danger-50 p-2 rounded">{error}</div>
                )}
                <Select
                  label="Resident"
                  selectedKeys={residentId ? [residentId] : []}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (selected) setResidentId(selected as string);
                  }}
                  isRequired
                >
                  {residents.map((r) => (
                    <SelectItem key={r.id}>{r.full_name}</SelectItem>
                  ))}
                </Select>
                <Input
                  label="Title"
                  value={title}
                  onValueChange={setTitle}
                  isRequired
                />
                <Input
                  label="Target Count"
                  type="number"
                  value={targetCount}
                  onValueChange={setTargetCount}
                  isRequired
                />
                <Input
                  label="Specialty"
                  value={specialty}
                  onValueChange={setSpecialty}
                />
                <Input
                  label="Deadline"
                  type="date"
                  value={deadline}
                  onValueChange={setDeadline}
                  isRequired
                />
                <Textarea
                  label="Description"
                  value={description}
                  onValueChange={setDescription}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>Cancel</Button>
                <Button
                  color="primary"
                  onPress={() => handleSubmit(onClose)}
                  isLoading={loading}
                >
                  Create
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
