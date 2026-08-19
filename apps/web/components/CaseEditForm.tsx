'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface CaseEntry {
  id: string;
  tenant_id: string;
  resident_id: string;
  template_id: string;
  patient_mrn: string | null;
  patient_dob: string | null;
  patient_age_years: number | null;
  case_date: string;
  field_values: Record<string, unknown>;
  status: string;
  is_deidentified: boolean;
  accreditation_mappings: unknown[];
  case_templates: {
    name: string;
    specialty: string;
    fields: TemplateField[];
  };
}

interface CaseEditFormProps {
  entry: CaseEntry;
  tenantSlug: string;
}

const inputBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const textareaBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary min-h-[80px] resize-y';

export default function CaseEditForm({ entry, tenantSlug }: CaseEditFormProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const { show: showToast } = useToast();

  const [caseDate, setCaseDate] = useState(entry.case_date);
  const [patientMrn, setPatientMrn] = useState(entry.patient_mrn || '');
  const [patientDob, setPatientDob] = useState(entry.patient_dob || '');
  const [patientAgeYears, setPatientAgeYears] = useState(entry.patient_age_years?.toString() || '');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(entry.field_values || {});
  const [isDeidentified, setIsDeidentified] = useState(entry.is_deidentified);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const fields = entry.case_templates?.fields || [];

  function getFieldKey(f: TemplateField): string {
    return f.key || f.name || '';
  }

  async function handleSave() {
    setErrors([]);
    setSaving(true);

    // Validate required fields
    const requiredFields = fields.filter(f => f.required);
    for (const field of requiredFields) {
      const key = getFieldKey(field);
      if (!fieldValues[key]) {
        setErrors([`${field.label} is required.`]);
        setSaving(false);
        return;
      }
    }

    const updateData: Record<string, unknown> = {
      case_date: caseDate,
      field_values: fieldValues,
      is_deidentified: isDeidentified,
    };

    if (isDeidentified) {
      updateData.patient_mrn = null;
      updateData.patient_dob = null;
      updateData.patient_age_years = Number(patientAgeYears) || null;
    } else {
      updateData.patient_mrn = patientMrn || null;
      updateData.patient_dob = patientDob || null;
      updateData.patient_age_years = null;
    }

    const { error } = await supabase
      .from('case_entries')
      .update(updateData)
      .eq('id', entry.id);

    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Case updated successfully', 'success');
      router.push(`/${tenantSlug}/cases/${entry.id}`);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="panel">
        <div className="pb-4 border-b border-border">
          <h1 className="text-xl font-bold">
            Edit Case — {entry.case_templates?.specialty} — {entry.case_templates?.name}
          </h1>
          <p className="text-sm text-text-muted mt-1">Edit your draft case details</p>
        </div>

        <div className="pt-4 space-y-4">
          {/* Case Date */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-primary">
              Case Date<span className="text-danger ml-0.5">*</span>
            </label>
            <input
              type="date"
              value={caseDate}
              onChange={(e) => setCaseDate(e.target.value)}
              aria-label="Case date"
              className={inputBase}
            />
          </div>

          {/* De-identify toggle */}
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="edit-deidentify"
              checked={entry.is_deidentified}
              disabled
              className="h-4 w-4 rounded border-black/20 text-primary focus:ring-primary accent-primary opacity-50"
            />
            <label htmlFor="edit-deidentify" className="text-sm text-text-secondary">
              De-identify patient data (cannot be changed after creation)
            </label>
          </div>

          {/* Patient info (only for identified cases) */}
          {!entry.is_deidentified && (
            <>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-primary">
                  Patient MRN
                </label>
                <input
                  type="text"
                  value={patientMrn}
                  onChange={(e) => setPatientMrn(e.target.value)}
                  placeholder="Enter MRN"
                  aria-label="Patient MRN"
                  className={inputBase}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-primary">
                  Patient DOB
                </label>
                <input
                  type="date"
                  value={patientDob}
                  onChange={(e) => setPatientDob(e.target.value)}
                  aria-label="Patient date of birth"
                  className={inputBase}
                />
              </div>
            </>
          )}

          {/* Dynamic template fields */}
          {fields.length > 0 && (
            <div className="border-t border-border pt-4 mt-2">
              <h4 className="text-sm font-semibold text-text-primary mb-3">Case Details</h4>
              <div className="space-y-3">
                {fields.map((field) => {
                  const key = getFieldKey(field);
                  const label = field.label;
                  const type = field.type;
                  const options = field.options || [];
                  const value = fieldValues[key] || '';

                  switch (type) {
                    case 'textarea':
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="block text-sm font-medium text-text-primary">
                            {label}{field.required && <span className="text-danger ml-0.5">*</span>}
                          </label>
                          <textarea
                            value={value as string}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.value }))}
                            aria-label={label}
                            className={textareaBase}
                          />
                        </div>
                      );
                    case 'select':
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="block text-sm font-medium text-text-primary">
                            {label}{field.required && <span className="text-danger ml-0.5">*</span>}
                          </label>
                          <select
                            value={value as string}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.value }))}
                            aria-label={`Select ${label}`}
                            className={inputBase}
                          >
                            <option value="">Select {label.toLowerCase()}</option>
                            {options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      );
                    case 'number':
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="block text-sm font-medium text-text-primary">
                            {label}{field.required && <span className="text-danger ml-0.5">*</span>}
                          </label>
                          <input
                            type="number"
                            value={value as string}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.value }))}
                            aria-label={label}
                            className={inputBase}
                          />
                        </div>
                      );
                    case 'date':
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="block text-sm font-medium text-text-primary">
                            {label}{field.required && <span className="text-danger ml-0.5">*</span>}
                          </label>
                          <input
                            type="date"
                            value={value as string}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.value }))}
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
                            id={`edit-field-${key}`}
                            checked={!!value}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.checked }))}
                            className="h-4 w-4 rounded border-black/20 text-primary focus:ring-primary accent-primary"
                            aria-label={label}
                          />
                          <label htmlFor={`edit-field-${key}`} className="text-sm text-text-secondary">
                            {label}
                          </label>
                        </div>
                      );
                    default:
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="block text-sm font-medium text-text-primary">
                            {label}{field.required && <span className="text-danger ml-0.5">*</span>}
                          </label>
                          <input
                            type="text"
                            value={value as string}
                            onChange={(e) => setFieldValues(prev => ({ ...prev, [key]: e.target.value }))}
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
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-6 border-t border-border">
          <button
            onClick={handleSave}
            className="px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Save Changes
          </button>
          <button
            onClick={() => router.push(`/${tenantSlug}/cases/${entry.id}`)}
            className="px-4 py-2.5 rounded-full border border-border text-text-secondary text-sm font-medium hover:bg-neutral-dark transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
