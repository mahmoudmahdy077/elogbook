'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  TextField,
  TextArea,
  Chip,
  Table,
  Modal,
  useOverlayState,
  Label,
  Input,
} from '@heroui/react';
import ErrorDisplay from '@/components/ErrorDisplay';
import { createClient } from '@/lib/supabase/client';

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface CaseTemplate {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  updated_at: string;
}

interface TemplateEditorProps {
  tenantId: string;
  templates: CaseTemplate[];
}

export default function TemplateEditor({ tenantId, templates }: TemplateEditorProps) {
  const router = useRouter();
  const overlay = useOverlayState({ defaultOpen: false });

  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [fieldsJson, setFieldsJson] = useState('');
  const [requiredFieldsInput, setRequiredFieldsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setName('');
    setSpecialty('');
    setFieldsJson('');
    setRequiredFieldsInput('');
    setError('');
  }

  async function handleCreate(closeModal: () => void) {
    setError('');

    if (!name.trim() || !specialty.trim() || !fieldsJson.trim()) {
      setError('Name, Specialty, and Fields are required.');
      return;
    }

    let parsedFields: TemplateField[];
    try {
      parsedFields = JSON.parse(fieldsJson);
      if (!Array.isArray(parsedFields)) throw new Error('Expected an array');
    } catch {
      setError('Invalid JSON for Fields. Must be an array of field objects.');
      return;
    }

    const requiredFields = requiredFieldsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setLoading(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from('case_templates').insert({
      tenant_id: tenantId,
      name: name.trim(),
      specialty: specialty.trim(),
      fields: parsedFields,
      required_fields: requiredFields,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    resetForm();
    router.refresh();
    overlay.close();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from('case_templates').delete().eq('id', id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    router.refresh();
  }

  return (
    <div>
      {error && <ErrorDisplay message={error} />}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Existing Templates</h2>
        <Button onPress={overlay.open} variant="primary">
          New Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-default-500">No templates created yet.</p>
      ) : (
        <Table.Root aria-label="Case templates table" variant="primary">
          <Table.Content>
          <Table.Header>
            <Table.Column id="name">Name</Table.Column>
            <Table.Column id="specialty">Specialty</Table.Column>
            <Table.Column id="fields">Fields</Table.Column>
            <Table.Column id="required">Required</Table.Column>
            <Table.Column id="actions">Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {templates.map((t) => (
              <Table.Row key={t.id} id={t.id}>
                <Table.Cell>{t.name}</Table.Cell>
                <Table.Cell>
                  <Chip variant="soft" size="sm" color="accent">
                    {t.specialty}
                  </Chip>
                </Table.Cell>
                <Table.Cell>{t.fields?.length ?? 0}</Table.Cell>
                <Table.Cell>{t.required_fields?.length ?? 0}</Table.Cell>
                <Table.Cell>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    onPress={() => handleDelete(t.id)}
                  >
                    Delete
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
          </Table.Content>
        </Table.Root>
      )}

      <Modal.Root isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
        <Modal.Header>Create Case Template</Modal.Header>
        <Modal.Body className="gap-4">
          <TextField
            value={name}
            onChange={setName}
            isRequired
          >
            <Label>Template Name</Label>
            <Input placeholder="e.g. General Surgery Log" />
          </TextField>
          <TextField
            value={specialty}
            onChange={setSpecialty}
            isRequired
          >
            <Label>Specialty</Label>
            <Input placeholder="e.g. Surgery" />
          </TextField>
          <Label>Fields JSON</Label>
          <TextArea
            value={fieldsJson}
            onChange={(e) => setFieldsJson(e.target.value)}
            required
            rows={6}
          />
          <TextField
            value={requiredFieldsInput}
            onChange={setRequiredFieldsInput}
          >
            <Label>Required Fields (comma-separated)</Label>
            <Input placeholder="Diagnosis, Procedure" />
          </TextField>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onPress={overlay.close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => handleCreate(overlay.close)}
            isDisabled={loading}
          >
            Create Template
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </div>
  );
}
