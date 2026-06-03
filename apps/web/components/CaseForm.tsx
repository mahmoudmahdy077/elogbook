'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, SelectItem, Textarea, Card, CardBody } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { createClient } from '@/lib/supabase/client';
import { caseEntrySchema } from '@elogbook/shared';

const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000';

interface CaseFormProps {
  tenantId: string;
  tenantSlug: string;
  initialStatus: string;
}

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface Template {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
}

export default function CaseForm({ tenantId, tenantSlug, initialStatus }: CaseFormProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    async function loadTemplates() {
      const { data: tenantTemplates, error } = await supabase
        .from('case_templates')
        .select('*')
        .eq('tenant_id', tenantId);

      const { data: globalTemplates } = await supabase
        .from('case_templates')
        .select('*')
        .eq('tenant_id', GLOBAL_TENANT_ID);

      if (error) {
        setErrors([error.message]);
      } else {
        const all = [...(tenantTemplates || []), ...(globalTemplates || [])] as Template[];
        setTemplates(all);
      }
      setLoadingTemplates(false);
    }
    loadTemplates();
  }, [tenantId, supabase]);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const fields = selectedTemplate?.fields || [];

  function getFieldKey(f: TemplateField): string {
    return f.key || f.name || '';
  }

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);

    const payload = {
      template_id: selectedTemplateId,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
    };

    const result = caseEntrySchema.safeParse(payload);
    if (!result.success) {
      setErrors(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('case_entries').insert({
      tenant_id: tenantId,
      template_id: selectedTemplateId,
      patient_mrn: patientMrn,
      patient_dob: patientDob,
      case_date: caseDate,
      field_values: fieldValues,
      status: initialStatus,
    });

    if (error) {
      setErrors([error.message]);
      setLoading(false);
      return;
    }

    router.push(`/${tenantSlug}/cases`);
  }

  function selectedKeysSet(value: string): Set<string> {
    return value ? new Set([value]) : new Set();
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardBody className="gap-4">
          {errors.length > 0 && (
            <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm">
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}

          <Select
            label="Case Template"
            placeholder="Select a template"
            selectedKeys={selectedKeysSet(selectedTemplateId)}
            onSelectionChange={(keys) => {
              const key = Array.from(keys)[0] as string;
              setSelectedTemplateId(key || '');
              setFieldValues({});
            }}
            isLoading={loadingTemplates}
          >
            {templates.map(t => (
              <SelectItem key={t.id}>{t.specialty} - {t.name}</SelectItem>
            ))}
          </Select>

          <Input
            label="Patient MRN"
            value={patientMrn}
            onValueChange={setPatientMrn}
            isRequired
          />

          <Input
            label="Patient DOB"
            type="date"
            value={patientDob}
            onValueChange={setPatientDob}
            isRequired
          />

          <Input
            label="Case Date"
            type="date"
            value={caseDate}
            onValueChange={setCaseDate}
            isRequired
          />

          {selectedTemplateId && fields.length > 0 && (
            <div className="border-t pt-4 mt-2">
              <h3 className="font-semibold mb-3">Template Fields</h3>
              {fields.map((field) => {
                const key = getFieldKey(field);
                const label = field.label;
                const type = field.type;
                const options = field.options || [];

                switch (type) {
                  case 'textarea':
                    return (
                      <Textarea
                        key={key}
                        label={label}
                        value={(fieldValues[key] as string) || ''}
                        onValueChange={(v) => handleFieldChange(key, v)}
                        className="mb-3"
                      />
                    );
                  case 'select':
                    return (
                      <Select
                        key={key}
                        label={label}
                        selectedKeys={selectedKeysSet((fieldValues[key] as string) || '')}
                        onSelectionChange={(keys) => {
                          const val = Array.from(keys)[0] as string;
                          handleFieldChange(key, val || '');
                        }}
                        className="mb-3"
                      >
                        {options.map((opt: string) => (
                          <SelectItem key={opt}>{opt}</SelectItem>
                        ))}
                      </Select>
                    );
                  case 'number':
                    return (
                      <Input
                        key={key}
                        label={label}
                        type="number"
                        value={(fieldValues[key] as string) || ''}
                        onValueChange={(v) => handleFieldChange(key, v)}
                        className="mb-3"
                      />
                    );
                  case 'date':
                    return (
                      <Input
                        key={key}
                        label={label}
                        type="date"
                        value={(fieldValues[key] as string) || ''}
                        onValueChange={(v) => handleFieldChange(key, v)}
                        className="mb-3"
                      />
                    );
                  case 'checkbox':
                    return (
                      <div key={key} className="mb-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`field-${key}`}
                          checked={!!fieldValues[key]}
                          onChange={(e) => handleFieldChange(key, e.target.checked)}
                          className="rounded"
                        />
                        <label htmlFor={`field-${key}`} className="text-sm">{label}</label>
                      </div>
                    );
                  default:
                    return (
                      <Input
                        key={key}
                        label={label}
                        value={(fieldValues[key] as string) || ''}
                        onValueChange={(v) => handleFieldChange(key, v)}
                        className="mb-3"
                      />
                    );
                }
              })}
            </div>
          )}

          <Button
            type="submit"
            color="primary"
            isLoading={loading}
            isDisabled={!selectedTemplateId || loadingTemplates}
          >
            Save Case
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
