'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TextField, TextArea, Select, ListBox, ListBoxItem, Switch } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
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

interface AccreditationFramework {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  framework_type: string;
  milestones: Array<{
    code: string;
    description: string;
    competency_area: string;
    target_minimum: number;
    specialty?: string;
  }>;
}

const STEPS = ['Template', 'Patient Info', 'Case Details', 'Review'];

const stepVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export default function CaseForm({ tenantId, tenantSlug, initialStatus }: CaseFormProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [step, setStep] = useState(0);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const [isDeidentified, setIsDeidentified] = useState(false);
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [patientAgeYears, setPatientAgeYears] = useState('');

  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});

  const [accreditationFrameworks, setAccreditationFrameworks] = useState<AccreditationFramework[]>([]);

  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadTemplates() {
      const [{ data: tenantTemplates, error }, { data: globalTemplates }] = await Promise.all([
        supabase.from('case_templates').select('*').eq('tenant_id', tenantId),
        supabase.from('case_templates').select('*').eq('tenant_id', GLOBAL_TENANT_ID),
      ]);

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

  useEffect(() => {
    async function loadFrameworks() {
      const { data } = await supabase
        .from('accreditation_frameworks')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data) {
        setAccreditationFrameworks(data as AccreditationFramework[]);
      }
    }
    loadFrameworks();
  }, [tenantId, supabase]);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const fields = selectedTemplate?.fields || [];

  function getFieldKey(f: TemplateField): string {
    return f.key || f.name || '';
  }

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  }

  function canProceed(stepIndex: number): boolean {
    switch (stepIndex) {
      case 0:
        return !!selectedTemplateId;
      case 1:
        if (isDeidentified) {
          return patientAgeYears.trim() !== '' && !isNaN(Number(patientAgeYears));
        }
        return patientMrn.trim() !== '' && patientDob.trim() !== '';
      case 2:
        return caseDate.trim() !== '';
      default:
        return true;
    }
  }

  function handleNext() {
    if (step < STEPS.length - 1 && canProceed(step)) {
      setErrors([]);
      setStep(prev => prev + 1);
    }
  }

  function handleBack() {
    if (step > 0) {
      setErrors([]);
      setStep(prev => prev - 1);
    }
  }

  async function handleSubmit() {
    setErrors([]);

    const parsedAge = Number(patientAgeYears);
    const hash = isDeidentified ? btoa(patientMrn.trim() || 'anonymous') : '';

    const payload: Record<string, unknown> = isDeidentified
      ? {
          template_id: selectedTemplateId,
          patient_age_years: parsedAge,
          patient_hash: hash,
          case_date: caseDate,
          field_values: fieldValues,
          accreditation_mappings: [],
          is_deidentified: true as const,
        }
      : {
          template_id: selectedTemplateId,
          patient_mrn: patientMrn,
          patient_dob: patientDob,
          case_date: caseDate,
          field_values: fieldValues,
          accreditation_mappings: [],
          is_deidentified: false as const,
        };

    const result = caseEntrySchema.safeParse(payload);
    if (!result.success) {
      setErrors(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
      return;
    }

    setLoading(true);

    const insertData: Record<string, unknown> = {
      tenant_id: tenantId,
      template_id: selectedTemplateId,
      case_date: caseDate,
      field_values: fieldValues,
      status: initialStatus,
      accreditation_mappings: [],
      is_deidentified: isDeidentified,
    };

    if (isDeidentified) {
      insertData.patient_mrn = null;
      insertData.patient_dob = null;
      insertData.patient_age_years = parsedAge;
      insertData.patient_hash = hash;
    } else {
      insertData.patient_mrn = patientMrn;
      insertData.patient_dob = patientDob;
      insertData.patient_age_years = null;
      insertData.patient_hash = null;
    }

    const { error } = await supabase.from('case_entries').insert(insertData);

    if (error) {
      setErrors([error.message]);
      setLoading(false);
      return;
    }

    router.push(`/${tenantSlug}/cases`);
  }

  function renderStepIndicator() {
    return (
      <div className="flex items-center justify-center mb-8 gap-0">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                  i < step
                    ? 'bg-primary text-white'
                    : i === step
                      ? 'bg-primary text-white ring-4 ring-primary-glow'
                      : 'bg-neutral-dark border border-border text-neutral-light'
                }`}
              >
                {i < step ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M11.5 3.5L5.5 9.5L2.5 6.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span
                className={`text-xs mt-1.5 font-medium ${
                  i <= step ? 'text-primary' : 'text-neutral-light/40'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 sm:w-16 h-0.5 mx-1 mt-[-1rem] transition-all duration-300 ${
                  i < step ? 'bg-primary' : 'bg-border'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderTemplateStep() {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
          Select Case Template
        </h3>
        <p className="text-sm text-neutral-light/60">
          Choose a template for your logbook entry. This determines the required fields for
          documentation.
        </p>
        <Select
          label="Case Template"
          placeholder="Select a template"
          selectedKey={selectedTemplateId || null}
          onSelectionChange={(key) => {
            setSelectedTemplateId(key || '');
            setFieldValues({});
          }}
          isLoading={loadingTemplates}
          isRequired
        >
          <Select.Trigger aria-label="Select template">
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Select a template">
              {templates.map(t => (
                <ListBoxItem id={t.id}>
                  {t.specialty} - {t.name}
                </ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {selectedTemplate && (
          <div className="text-sm text-neutral-light/60">
            {fields.length} field{fields.length !== 1 ? 's' : ''} in this template
          </div>
        )}
      </div>
    );
  }

  function renderPatientInfoStep() {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
          Patient Information
        </h3>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-dark/50 border border-border">
          <Switch isSelected={isDeidentified} onChange={setIsDeidentified}>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <Switch.Content>
              <span className="text-sm font-medium ml-3">De-identify Patient Data</span>
            </Switch.Content>
          </Switch>
        </div>

        {isDeidentified ? (
          <>
            <div className="warning-banner text-xs rounded-lg p-2.5">
              HIPAA Safe Harbor: No PHI will be stored. MRN encoded client-side before submission.
            </div>
            <TextField
              label="Patient MRN (encoded client-side)"
              value={patientMrn}
              onChange={setPatientMrn}
              placeholder="Enter MRN for local hashing"
            />
            <TextField
              label="Patient Age (years)"
              type="number"
              value={patientAgeYears}
              onChange={setPatientAgeYears}
              isRequired
              placeholder="0-150"
            />
          </>
        ) : (
          <>
            <div className="danger-banner text-xs rounded-lg p-2.5">
              PII Warning: Patient MRN and Date of Birth will be stored. Ensure compliance with your
              institution&apos;s data protection policies.
            </div>
            <TextField
              label="Patient MRN"
              value={patientMrn}
              onChange={setPatientMrn}
              isRequired
            />
            <TextField
              label="Patient DOB"
              type="date"
              value={patientDob}
              onChange={setPatientDob}
              isRequired
            />
          </>
        )}
      </div>
    );
  }

  function renderCaseDetailsStep() {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
          Case Details
        </h3>

        <TextField
          label="Case Date"
          type="date"
          value={caseDate}
          onChange={setCaseDate}
          isRequired
        />

        {selectedTemplateId && fields.length > 0 && (
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
                      <TextArea
                        key={key}
                        label={label}
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      />
                    );
                  case 'select':
                    return (
                      <Select
                        key={key}
                        label={label}
                        selectedKey={(fieldValues[key] as string) || null}
                        onSelectionChange={(val) => handleFieldChange(key, val || '')}
                      >
                        <Select.Trigger aria-label={`Select ${label}`}>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox aria-label={label}>
                            {options.map((opt: string) => (
                              <ListBoxItem id={opt}>{opt}</ListBoxItem>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    );
                  case 'number':
                    return (
                      <TextField
                        key={key}
                        label={label}
                        type="number"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      />
                    );
                  case 'date':
                    return (
                      <TextField
                        key={key}
                        label={label}
                        type="date"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      />
                    );
                  case 'checkbox':
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`field-${key}`}
                          checked={!!fieldValues[key]}
                          onChange={(e) => handleFieldChange(key, e.target.checked)}
                          className="rounded"
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
                        label={label}
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      />
                    );
                }
              })}
            </div>
          </div>
        )}
        {selectedTemplateId && fields.length === 0 && (
          <p className="text-sm text-neutral-light/40 italic">
            No fields defined for this template.
          </p>
        )}
      </div>
    );
  }

  function renderReviewStep() {
    const hashPreview =
      isDeidentified && patientMrn ? btoa(patientMrn) : '-';

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
          Review
        </h3>
        <p className="text-sm text-neutral-light/60">
          Review your entry before submitting.
        </p>

        <div className="space-y-2 divide-y divide-border">
          <div className="flex justify-between py-2">
            <span className="text-sm text-neutral-light/60">Template</span>
            <span className="text-sm font-medium">
              {selectedTemplate?.specialty} - {selectedTemplate?.name}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-sm text-neutral-light/60">De-identified</span>
            <span className="text-sm font-medium">{isDeidentified ? 'Yes' : 'No'}</span>
          </div>
          {isDeidentified ? (
            <>
              <div className="flex justify-between py-2">
                <span className="text-sm text-neutral-light/60">Patient Age</span>
                <span className="text-sm font-medium">{patientAgeYears} years</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-neutral-light/60">MRN Hash</span>
                <span className="text-xs font-mono text-neutral-light/50 truncate max-w-[200px]">
                  {hashPreview}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between py-2">
                <span className="text-sm text-neutral-light/60">Patient MRN</span>
                <span className="text-sm font-medium">{patientMrn || '-'}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-neutral-light/60">Patient DOB</span>
                <span className="text-sm font-medium">{patientDob || '-'}</span>
              </div>
            </>
          )}
          <div className="flex justify-between py-2">
            <span className="text-sm text-neutral-light/60">Case Date</span>
            <span className="text-sm font-medium">{caseDate || '-'}</span>
          </div>
          {Object.entries(fieldValues).length > 0 && (
            <div className="py-2">
              <span className="text-sm text-neutral-light/60 block mb-2">Template Fields</span>
              {fields.map((field) => {
                const key = getFieldKey(field);
                const value = fieldValues[key];
                let display: string;
                if (field.type === 'checkbox') {
                  display = value ? 'Yes' : 'No';
                } else if (value !== undefined && value !== '') {
                  display = String(value);
                } else {
                  display = '-';
                }
                return (
                  <div key={key} className="flex justify-between py-1">
                    <span className="text-xs text-neutral-light/40">{field.label}</span>
                    <span className="text-xs font-medium">{display}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderNavigation() {
    return (
      <div className="flex justify-between mt-6 pt-4 border-t border-border">
        <Button variant="light" onPress={handleBack} isDisabled={step === 0}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button color="primary" onPress={handleNext} isDisabled={!canProceed(step)}>
            Continue
          </Button>
        ) : (
          <Button color="primary" onPress={handleSubmit} isLoading={loading}>
            Submit Case
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel p-6">
      {renderStepIndicator()}

      {errors.length > 0 && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4" role="alert">
          {errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={stepVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          {step === 0 && renderTemplateStep()}
          {step === 1 && renderPatientInfoStep()}
          {step === 2 && renderCaseDetailsStep()}
          {step === 3 && renderReviewStep()}
        </motion.div>
      </AnimatePresence>

      {renderNavigation()}
    </div>
  );
}
