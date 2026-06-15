'use client';

import { TextField, TextArea, Select, ListBox, ListBoxItem, Label, Input } from '@heroui/react';

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
  specialty: string;
  name: string;
  fields: TemplateField[];
}

interface CaseDetailsStepProps {
  template: Template | undefined;
  fieldValues: Record<string, unknown>;
  caseDate: string;
  onCaseDateChange: (value: string) => void;
  onFieldChange: (key: string, value: unknown) => void;
  getFieldKey: (f: TemplateField) => string;
}

export default function CaseDetailsStep({
  template,
  fieldValues,
  caseDate,
  onCaseDateChange,
  onFieldChange,
  getFieldKey,
}: CaseDetailsStepProps) {
  const fields = template?.fields || [];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
        Case Details
      </h3>

      <TextField
        type="date"
        value={caseDate}
        onChange={onCaseDateChange}
        isRequired
      >
        <Label>Case Date</Label>
        <Input aria-label="Case date" />
      </TextField>

      {template && fields.length > 0 && (
        <div className="border-t border-border pt-4 mt-2">
          <h4 className="text-sm font-semibold mb-3 text-neutral-light/80">Template Fields</h4>
          <div className="space-y-3">
            {fields.map((field) => {
              const key = getFieldKey(field);
              const label = field.label;
              const type = field.type;
              const options = field.options || [];

              switch (type) {
                case 'textarea':
                  return (
                    <div key={key}>
                      <Label>{label}</Label>
                      <TextArea
                        value={(fieldValues[key] as string) || ''}
                        onChange={(e) => onFieldChange(key, e.target.value)}
                        aria-label={label}
                      />
                    </div>
                  );
                case 'select':
                  return (
                    <Select
                      key={key}
                      selectedKey={(fieldValues[key] as string) || null}
                      onSelectionChange={(val) => onFieldChange(key, val ? String(val) : '')}
                    >
                      <Select.Trigger aria-label={`Select ${label}`}>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox aria-label={label}>
                          {options.map((opt: string) => (
                            <ListBoxItem key={opt} id={opt}>{opt}</ListBoxItem>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  );
                case 'number':
                  return (
                    <TextField
                      key={key}
                      type="number"
                      value={(fieldValues[key] as string) || ''}
                      onChange={(v: string) => onFieldChange(key, v)}
                    >
                      <Label>{label}</Label>
                      <Input aria-label={label} />
                    </TextField>
                  );
                case 'date':
                  return (
                    <TextField
                      key={key}
                      type="date"
                      value={(fieldValues[key] as string) || ''}
                      onChange={(v: string) => onFieldChange(key, v)}
                    >
                      <Label>{label}</Label>
                      <Input aria-label={label} />
                    </TextField>
                  );
                case 'checkbox':
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`field-${key}`}
                        checked={!!fieldValues[key]}
                        onChange={(e) => onFieldChange(key, e.target.checked)}
                        className="rounded"
                        aria-label={label}
                      />
                      <label htmlFor={`field-${key}`} className="text-sm">
                        {label}
                      </label>
                    </div>
                  );
                default:
                  return (
                    <TextField
                      key={key}
                      value={(fieldValues[key] as string) || ''}
                      onChange={(v: string) => onFieldChange(key, v)}
                    >
                      <Label>{label}</Label>
                      <Input aria-label={label} />
                    </TextField>
                  );
              }
            })}
          </div>
        </div>
      )}
      {template && fields.length === 0 && (
        <p className="text-sm text-neutral-light/50 italic">
          No fields defined for this template.
        </p>
      )}
    </div>
  );
}