'use client';

import { useState } from 'react';

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

/* Shared input base class matching Apple Health style */
const inputBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const textareaBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary min-h-[80px] resize-y';

/* Apple-style select dropdown */
function SelectField({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-text-primary">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel || label}
        className={inputBase + ' appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%238E8E93%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10'}
      >
        <option value="" disabled>
          Select {label.toLowerCase()}
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
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
  const [selectValues, setSelectValues] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
        Case Details
      </h3>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-text-primary">
          Case Date<span className="text-danger ml-0.5">*</span>
        </label>
        <input
          type="date"
          value={caseDate}
          onChange={(e) => onCaseDateChange(e.target.value)}
          aria-label="Case date"
          className={inputBase}
        />
      </div>

      {template && fields.length > 0 && (
        <div className="border-t border-border pt-4 mt-2">
          <h4 className="text-sm font-semibold text-text-primary mb-3">Template Fields</h4>
          <div className="space-y-3">
            {fields.map((field) => {
              const key = getFieldKey(field);
              const label = field.label;
              const type = field.type;
              const options = field.options || [];

              switch (type) {
                case 'textarea':
                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="block text-sm font-medium text-text-primary">{label}</label>
                      <textarea
                        value={(fieldValues[key] as string) || ''}
                        onChange={(e) => onFieldChange(key, e.target.value)}
                        aria-label={label}
                        className={textareaBase}
                      />
                    </div>
                  );
                case 'select':
                  return (
                    <SelectField
                      key={key}
                      label={label}
                      value={selectValues[key] || (fieldValues[key] as string) || ''}
                      options={options}
                      onChange={(val) => {
                        setSelectValues((prev) => ({ ...prev, [key]: val }));
                        onFieldChange(key, val);
                      }}
                      ariaLabel={`Select ${label}`}
                    />
                  );
                case 'number':
                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="block text-sm font-medium text-text-primary">{label}</label>
                      <input
                        type="number"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(e) => onFieldChange(key, e.target.value)}
                        aria-label={label}
                        className={inputBase}
                      />
                    </div>
                  );
                case 'date':
                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="block text-sm font-medium text-text-primary">{label}</label>
                      <input
                        type="date"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(e) => onFieldChange(key, e.target.value)}
                        aria-label={label}
                        className={inputBase}
                      />
                    </div>
                  );
                case 'checkbox':
                  return (
                    <div key={key} className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id={`field-${key}`}
                        checked={!!fieldValues[key]}
                        onChange={(e) => onFieldChange(key, e.target.checked)}
                        className="h-4 w-4 rounded border-black/20 text-primary focus:ring-primary accent-primary"
                        aria-label={label}
                      />
                      <label htmlFor={`field-${key}`} className="text-sm text-text-secondary">
                        {label}
                      </label>
                    </div>
                  );
                default:
                  return (
                    <div key={key} className="space-y-1.5">
                      <label className="block text-sm font-medium text-text-primary">{label}</label>
                      <input
                        type="text"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(e) => onFieldChange(key, e.target.value)}
                        aria-label={label}
                        className={inputBase}
                      />
                    </div>
                  );
              }
            })}
          </div>
        </div>
      )}
      {template && fields.length === 0 && (
        <p className="text-sm text-text-muted italic">
          No fields defined for this template.
        </p>
      )}
    </div>
  );
}
