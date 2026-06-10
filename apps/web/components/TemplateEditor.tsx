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
} from '@heroui/react';
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
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Existing Templates</h2>
        <Button onPress={overlay.open} color="primary">
          New Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-default-500">No templates created yet.</p>
      ) : (
        <Table aria-label="Case templates table">
          <Table.Header>
            <Table.Column>Name</Table.Column>
            <Table.Column>Specialty</Table.Column>
            <Table.Column>Fields</Table.Column>
            <Table.Column>Required</Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {templates.map((t) => (
              <Table.Row key={t.id}>
                <Table.Cell>{t.name}</Table.Cell>
                <Table.Cell>
                  <Chip variant="flat" size="sm" color="primary">
                    {t.specialty}
                  </Chip>
                </Table.Cell>
                <Table.Cell>{t.fields?.length ?? 0}</Table.Cell>
                <Table.Cell>{t.required_fields?.length ?? 0}</Table.Cell>
                <Table.Cell>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => handleDelete(t.id)}
                  >
                    Delete
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <Modal.Root isOpen={overlay.isOpen} onOpenChange={overlay.setOpen} size="2xl">
        <Modal.Header>Create Case Template</Modal.Header>
        <Modal.Body className="gap-4">
          <TextField
            label="Template Name"
            value={name}
            onChange={setName}
            isRequired
            placeholder="e.g. General Surgery Log"
          />
          <TextField
            label="Specialty"
            value={specialty}
            onChange={setSpecialty}
            isRequired
            placeholder="e.g. Surgery"
          />
          <TextArea
            label="Fields JSON"
            value={fieldsJson}
            onChange={setFieldsJson}
            isRequired
            minRows={6}
            placeholder={`[\n  {"label": "Diagnosis", "type": "text"},\n  {"label": "Procedure", "type": "textarea"},\n  {"label": "Complexity", "type": "select", "options": ["Low", "Medium", "High"]}\n]`}
          />
          <TextField
            label="Required Fields (comma-separated)"
            value={requiredFieldsInput}
            onChange={setRequiredFieldsInput}
            placeholder="Diagnosis, Procedure"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="light" onPress={overlay.close}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={() => handleCreate(overlay.close)}
            isLoading={loading}
          >
            Create Template
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </div>
  );
}
