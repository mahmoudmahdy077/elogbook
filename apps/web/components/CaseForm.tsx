'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TextField, TextArea, Select, ListBox, ListBoxItem, Switch, Label, Input } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { caseEntrySchema } from '@elogbook/shared';
import HelpPopover from '@/components/HelpPopover';
import { useToast } from '@/components/Toast';
import ErrorDisplay from '@/components/ErrorDisplay';

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
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCaseId, setSubmittedCaseId] = useState<string | null>(null);
  const toast = useToast();

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (confirmSubmit) {
        if (e.key === 'Escape') setConfirmSubmit(false);
        return;
      }
      if (submitted) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setSubmitted(false);
          setSubmittedCaseId(null);
          setStep(0);
          setSelectedTemplateId('');
          setFieldValues({});
          setIsDeidentified(false);
          setPatientMrn('');
          setPatientDob('');
          setPatientAgeYears('');
          setCaseDate('');
          setErrors([]);
        }
        return;
      }

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      const isTextArea = target.tagName === 'TEXTAREA';

      if (e.key === 'Enter' && !e.shiftKey && !isTextArea) {
        e.preventDefault();
        if (step < STEPS.length - 1 && canProceed(step)) {
          setErrors([]);
          setStep(prev => prev + 1);
        } else if (step === STEPS.length - 1) {
          setConfirmSubmit(true);
        }
      }
      if (e.key === 'Escape') {
        if (step > 0) {
          setErrors([]);
          setStep(prev => prev - 1);
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [step, confirmSubmit, submitted]);

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

  async function handleSaveDraft() {
    setErrors([]);
    setSavingDraft(true);

    const insertData: Record<string, unknown> = {
      tenant_id: tenantId,
      template_id: selectedTemplateId,
      case_date: caseDate || new Date().toISOString().split('T')[0],
      field_values: fieldValues,
      status: 'draft',
      accreditation_mappings: [],
      is_deidentified: isDeidentified,
    };

    if (isDeidentified) {
      insertData.patient_mrn = null;
      insertData.patient_dob = null;
      insertData.patient_age_years = Number(patientAgeYears) || null;
      insertData.patient_hash = '';
    } else {
      insertData.patient_mrn = patientMrn || null;
      insertData.patient_dob = patientDob || null;
      insertData.patient_age_years = null;
      insertData.patient_hash = null;
    }

    const { error } = await supabase.from('case_entries').insert(insertData);

    if (error) {
      setErrors([error.message]);
      setSavingDraft(false);
      return;
    }

    toast.show('Draft saved — you can continue editing from My Cases', 'success');
    router.push(`/${tenantSlug}/cases`);
  }

  async function handleSubmit() {
    setErrors([]);

    const parsedAge = Number(patientAgeYears);

    const payload: Record<string, unknown> = isDeidentified
      ? {
          template_id: selectedTemplateId,
          patient_age_years: parsedAge,
          patient_hash: '',
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
      insertData.patient_hash = '';
    } else {
      insertData.patient_mrn = patientMrn;
      insertData.patient_dob = patientDob;
      insertData.patient_age_years = null;
      insertData.patient_hash = null;
    }

    const { data: inserted, error } = await supabase.from('case_entries').insert(insertData).select('id').single();

    if (error) {
      setErrors([error.message]);
      setLoading(false);
      return;
    }

    setSubmittedCaseId((inserted as { id: string })?.id || null);
    setSubmitted(true);
    setLoading(false);
    toast.show('Case logged successfully', 'success');
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
                role="status"
                aria-label={`${label}${i < step ? ' (completed)' : i === step ? ' (current)' : ''}`}
              >
                {i < step ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M11.5 3.5L5.5 9.5L2.5 6.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span aria-hidden="true">{i + 1}</span>
                )}
              </div>
              <span
                className={`text-xs mt-1.5 font-medium ${
                  i <= step ? 'text-primary' : 'text-neutral-light/50'
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
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
            Select Case Template
          </h3>
          <HelpPopover>
            <p className="mb-2">
              <strong>Templates</strong> define the fields you need to fill out for a particular type of clinical case.
            </p>
            <p className="mb-2">
              Templates are organized by <strong>specialty</strong> and <strong>case type</strong> — for example, a &ldquo;General Surgery &mdash; Laparoscopic Cholecystectomy&rdquo; template includes fields for operative findings, drain placement, and estimated blood loss.
            </p>
            <p>
              Your program director sets up templates that match your accreditation framework. If you&apos;re unsure which template to use, ask your supervisor.
            </p>
          </HelpPopover>
        </div>
        <p className="text-sm text-neutral-light/60">
          Choose a template for your logbook entry. This determines the required fields for
          documentation.
        </p>
        <Select
          selectedKey={selectedTemplateId || null}
          onSelectionChange={(key) => {
            setSelectedTemplateId(key ? String(key) : '');
            setFieldValues({});
          }}
          isRequired
        >
          <Select.Trigger aria-label="Select template">
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox aria-label="Select a template">
              {templates.map(t => (
                <ListBoxItem key={t.id} id={t.id}>
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
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
            Patient Information
          </h3>
          <HelpPopover>
            <p className="mb-2">
              <strong>De-identified mode</strong> keeps your case suitable for portfolio logging, research, and accreditation tracking. No protected health information (PHI) is stored — only age and an encoded reference number.
            </p>
            <p>
              <strong>PII mode</strong> stores full patient identifiers for hospital record-keeping. Use this only when your institution requires it, and ensure you comply with data protection policies.
            </p>
          </HelpPopover>
        </div>

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
            <div className="flex items-center gap-3 mb-3">
              <span className="badge-approved text-xs px-2.5 py-1 rounded-full">Safe Harbor Compliant</span>
              <span className="text-xs text-emerald-400">No PHI stored</span>
            </div>
            <div className="warning-banner text-xs rounded-lg p-2.5">
              De-identified mode: safe for portfolio logging. No PHI is stored. Patient hash will be computed server-side.
            </div>
            <TextField value={patientMrn} onChange={setPatientMrn}>
              <Label>Patient MRN (for reference only — not stored)</Label>
              <Input placeholder="Enter MRN for local hashing" />
            </TextField>
            <TextField
              type="number"
              value={patientAgeYears}
              onChange={setPatientAgeYears}
              isRequired
            >
              <Label>Patient Age (years)</Label>
              <Input placeholder="0-150" />
            </TextField>
          </>
        ) : (
          <>
            <div className="danger-banner text-xs rounded-lg p-2.5">
              PII mode: patient MRN and Date of Birth will be stored on the server. Only use this for hospital record-keeping. Ensure compliance with your institution&apos;s data protection policies before submitting.
            </div>
            <TextField
              value={patientMrn}
              onChange={setPatientMrn}
              isRequired
            >
              <Label>Patient MRN</Label>
              <Input />
            </TextField>
            <TextField
              type="date"
              value={patientDob}
              onChange={setPatientDob}
              isRequired
            >
              <Label>Patient DOB</Label>
              <Input />
            </TextField>
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
          type="date"
          value={caseDate}
          onChange={setCaseDate}
          isRequired
        >
          <Label>Case Date</Label>
          <Input />
        </TextField>

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
                      <>
                        <Label>{label}</Label>
                        <TextArea
                          key={key}
                          value={(fieldValues[key] as string) || ''}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                        />
                      </>
                    );
                  case 'select':
                    return (
                      <Select
                        key={key}
                        selectedKey={(fieldValues[key] as string) || null}
                        onSelectionChange={(val) => handleFieldChange(key, val ? String(val) : '')}
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
                        onChange={(v: string) => handleFieldChange(key, v)}
                      >
                        <Label>{label}</Label>
                        <Input />
                      </TextField>
                    );
                  case 'date':
                    return (
                      <TextField
                        key={key}
                        type="date"
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      >
                        <Label>{label}</Label>
                        <Input />
                      </TextField>
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
                        value={(fieldValues[key] as string) || ''}
                        onChange={(v: string) => handleFieldChange(key, v)}
                      >
                        <Label>{label}</Label>
                        <Input />
                      </TextField>
                    );
                }
              })}
            </div>
          </div>
        )}
        {selectedTemplateId && fields.length === 0 && (
          <p className="text-sm text-neutral-light/50 italic">
            No fields defined for this template.
          </p>
        )}
      </div>
    );
  }

  function renderReviewStep() {
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
                <span className="text-sm text-neutral-light/60">MRN</span>
                <span className="text-xs text-neutral-light/50">
                  Hashed server-side — not stored
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
                    <span className="text-xs text-neutral-light/50">{field.label}</span>
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
        <Button variant="ghost" onPress={handleBack} isDisabled={step === 0}>
          Back
        </Button>
        <div className="flex gap-3">
          {step >= 2 && selectedTemplateId && !submitted && (
            <Button variant="ghost" onPress={handleSaveDraft} isDisabled={savingDraft}>
              Save Draft
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onPress={handleNext} isDisabled={!canProceed(step)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onPress={() => setConfirmSubmit(true)} isDisabled={loading}>
              Submit Case
            </Button>
          )}
        </div>
      </div>
    );
  }

  function renderConfirmDialog() {
    return (
      <AnimatePresence>
        {confirmSubmit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setConfirmSubmit(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="panel p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-lg font-semibold font-heading mb-3">Confirm Submission</h3>

              <div className="space-y-3 mb-5 text-sm">
                <p className="text-neutral-light/80">
                  You are about to submit this case entry. Please verify the information below is correct.
                </p>

                <div className="bg-neutral-dark/50 rounded-lg p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-light/50">Template</span>
                    <span className="font-medium">{selectedTemplate?.specialty} — {selectedTemplate?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-light/50">Mode</span>
                    <span className={`font-medium ${isDeidentified ? 'text-amber-400' : 'text-red-400'}`}>
                      {isDeidentified ? 'De-identified' : 'PII'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-light/50">Case Date</span>
                    <span className="font-medium">{caseDate || '-'}</span>
                  </div>
                </div>

                {!isDeidentified && (
                  <div className="danger-banner text-xs rounded-lg p-2.5">
                    This case contains identifiable patient data (MRN, DOB). Ensure compliance with your institution&apos;s data policies.
                  </div>
                )}

                {isDeidentified && (
                  <div className="warning-banner text-xs rounded-lg p-2.5">
                    This case is de-identified. No protected health information will be stored on the server.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="ghost" onPress={() => setConfirmSubmit(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onPress={handleSubmit} isDisabled={loading}>
                  Confirm & Submit
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  function renderSubmittedState() {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="text-center py-8 space-y-5"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-400/10 border border-emerald-400/30">
          <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        </div>

        <div>
          <h3 className="text-xl font-heading font-bold mb-1">Case Logged Successfully</h3>
          <p className="text-sm text-neutral-light/50">
            Your case has been saved and is now visible in your logbook.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          {submittedCaseId && (
            <a
              href={`/${tenantSlug}/cases/${submittedCaseId}`}
              className="px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-neutral-light hover:border-primary hover:text-primary transition-colors"
            >
              View Case
            </a>
          )}
          <a
            href={`/${tenantSlug}/cases`}
            className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Go to My Cases
          </a>
        </div>

        <p className="text-xs text-neutral-light/50 pt-2">
          Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-dark border border-border text-xs">Enter</kbd> to log another case
        </p>
      </motion.div>
    );
  }

  return (
    <div className="glass-panel p-6">
      {!submitted && renderStepIndicator()}

      {errors.length > 0 && (
        <div className="mb-4">
          {errors.map((err, i) => (
            <ErrorDisplay key={i} message={err} />
          ))}
        </div>
      )}

      {submitted ? (
        renderSubmittedState()
      ) : (
        <>
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
        </>
      )}

      {renderConfirmDialog()}
    </div>
  );
}
