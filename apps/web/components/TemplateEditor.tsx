'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Input,
  Textarea,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
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
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

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

  async function handleCreate(onClose: () => void) {
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
    onClose();
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
        <Button onPress={onOpen} color="primary">
          New Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-default-500">No templates created yet.</p>
      ) : (
        <Table aria-label="Case templates table">
          <TableHeader>
            <TableColumn>Name</TableColumn>
            <TableColumn>Specialty</TableColumn>
            <TableColumn>Fields</TableColumn>
            <TableColumn>Required</TableColumn>
            <TableColumn>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>
                  <Chip variant="flat" size="sm" color="primary">
                    {t.specialty}
                  </Chip>
                </TableCell>
                <TableCell>{t.fields?.length ?? 0}</TableCell>
                <TableCell>{t.required_fields?.length ?? 0}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => handleDelete(t.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Create Case Template</ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label="Template Name"
                  value={name}
                  onValueChange={setName}
                  isRequired
                  placeholder="e.g. General Surgery Log"
                />
                <Input
                  label="Specialty"
                  value={specialty}
                  onValueChange={setSpecialty}
                  isRequired
                  placeholder="e.g. Surgery"
                />
                <Textarea
                  label="Fields JSON"
                  value={fieldsJson}
                  onValueChange={setFieldsJson}
                  isRequired
                  minRows={6}
                  placeholder={`[\n  {"label": "Diagnosis", "type": "text"},\n  {"label": "Procedure", "type": "textarea"},\n  {"label": "Complexity", "type": "select", "options": ["Low", "Medium", "High"]}\n]`}
                />
                <Input
                  label="Required Fields (comma-separated)"
                  value={requiredFieldsInput}
                  onValueChange={setRequiredFieldsInput}
                  placeholder="Diagnosis, Procedure"
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  onPress={() => handleCreate(onClose)}
                  isLoading={loading}
                >
                  Create Template
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
