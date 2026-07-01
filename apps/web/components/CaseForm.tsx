'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@heroui/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { caseEntrySchema, GLOBAL_TENANT_ID, type AccreditationMapping } from '@elogbook/shared';
import { useToast } from '@/components/Toast';
import ErrorDisplay from '@/components/ErrorDisplay';

import StepIndicator from '@/components/case-form/StepIndicator';
import TemplateStep from '@/components/case-form/TemplateStep';
import PatientInfoStep from '@/components/case-form/PatientInfoStep';
import CaseDetailsStep from '@/components/case-form/CaseDetailsStep';
import ReviewStep from '@/components/case-form/ReviewStep';
import ConfirmDialog from '@/components/case-form/ConfirmDialog';

export interface FormSetters {
  setSelectedTemplateId: (v: string) => void;
  setIsDeidentified: (v: boolean) => void;
  setPatientMrn: (v: string) => void;
  setPatientDob: (v: string) => void;
  setPatientAgeYears: (v: string) => void;
  setCaseDate: (v: string) => void;
  setFieldValues: (v: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setAccreditationMappings: (v: AccreditationMapping[]) => void;
}

export function hydrateDuplicateCase(sourceCase: Record<string, unknown>, setters: FormSetters): void {
  setters.setSelectedTemplateId(sourceCase.template_id as string);
  setters.setIsDeidentified(sourceCase.is_deidentified as boolean);
  setters.setPatientMrn('');
  setters.setPatientDob('');
  setters.setPatientAgeYears(sourceCase.patient_age_years != null ? String(sourceCase.patient_age_years) : '');
  setters.setCaseDate(new Date().toISOString().slice(0, 10));
  setters.setFieldValues((sourceCase.field_values as Record<string, unknown>) || {});
  setters.setAccreditationMappings((sourceCase.accreditation_mappings as AccreditationMapping[]) || []);
}

interface CaseFormProps {
  tenantId: string;
  tenantSlug: string;
  initialStatus: string;
  duplicateCaseId?: string;
  lastEntry?: boolean;
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

export default function CaseForm({ tenantId, tenantSlug, initialStatus, duplicateCaseId, lastEntry }: CaseFormProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [accreditationFrameworks, setAccreditationFrameworks] = useState<AccreditationFramework[]>([]);

  const [isDeidentified, setIsDeidentified] = useState(false);
  // SECURITY: patientMrn and patientDob are PHI. They MUST NOT be persisted to
  // localStorage, sessionStorage, or any other client-side storage. They live
  // only in React state and are written to the server on save/submit.
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [patientAgeYears, setPatientAgeYears] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [accreditationMappings, setAccreditationMappings] = useState<AccreditationMapping[]>([]);

  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCaseId, setSubmittedCaseId] = useState<string | null>(null);
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const fields = selectedTemplate?.fields || [];

  useEffect(() => {
    async function loadTemplates() {
      const [{ data: tenantTemplates, error }, { data: globalTemplates }] = await Promise.all([
        supabase.from('case_templates').select('*').eq('tenant_id', tenantId),
        supabase.from('case_templates').select('*').eq('tenant_id', GLOBAL_TENANT_ID),
      ]);
      if (error) {
        setErrors([error.message]);
      } else {
        setTemplates([...(tenantTemplates || []), ...(globalTemplates || [])] as Template[]);
      }
      setLoadingTemplates(false);
    }
    loadTemplates();
  }, [tenantId, supabase]);

  useEffect(() => {
    async function loadFrameworks() {
      const { data } = await supabase.from('accreditation_frameworks').select('*').eq('tenant_id', tenantId);
      if (data) setAccreditationFrameworks(data as AccreditationFramework[]);
    }
    loadFrameworks();
  }, [tenantId, supabase]);

  useEffect(() => {
    if (!duplicateCaseId && !lastEntry) return;

    async function loadSourceCase() {
      let sourceCase: Record<string, unknown> | null = null;

      if (duplicateCaseId) {
        const { data, error } = await supabase
          .from('case_entries')
          .select('*')
          .eq('id', duplicateCaseId)
          .single();
        if (error || !data) {
          if (error) setErrors([error.message]);
          return;
        }
        sourceCase = data as unknown as Record<string, unknown>;
      } else if (lastEntry) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();
        if (!profile) return;

        const { data, error } = await supabase
          .from('case_entries')
          .select('*')
          .eq('resident_id', profile.id)
          .in('status', ['pending', 'approved'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || !data) return;
        sourceCase = data as unknown as Record<string, unknown>;
      }

      if (!sourceCase) return;

      hydrateDuplicateCase(sourceCase, {
        setSelectedTemplateId,
        setIsDeidentified,
        setPatientMrn,
        setPatientDob,
        setPatientAgeYears,
        setCaseDate,
        setFieldValues,
        setAccreditationMappings,
      });
    }

    loadSourceCase();
  }, [duplicateCaseId, lastEntry, supabase]);

  function getFieldKey(f: TemplateField): string {
    return f.key || f.name || '';
  }

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  }

  const canProceed = useCallback((stepIndex: number): boolean => {
    switch (stepIndex) {
      case 0: return !!selectedTemplateId;
      case 1:
        return isDeidentified
          ? patientAgeYears.trim() !== '' && !isNaN(Number(patientAgeYears))
          : patientMrn.trim() !== '' && patientDob.trim() !== '';
      case 2: return caseDate.trim() !== '';
      default: return true;
    }
  }, [selectedTemplateId, isDeidentified, patientAgeYears, patientMrn, patientDob, caseDate]);

  function handleNext() {
    if (step < STEPS.length - 1 && canProceed(step)) {
      setErrors([]);
      setStep(prev => prev + 1);
    }
  }

  function handleBack() {
    if (step > 0) { setErrors([]); setStep(prev => prev - 1); }
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
      accreditation_mappings: accreditationMappings,
      is_deidentified: isDeidentified,
    };
    if (isDeidentified) {
      const mrnForHash = patientMrn || `temp-${Date.now()}`;
      const { data: hash, error: hashError } = await supabase.rpc('hash_patient_mrn', {
        p_mrn: mrnForHash,
        p_tenant_id: tenantId,
      });
      if (hashError) {
        setErrors(['Failed to generate patient hash. Please try again.']);
        setSavingDraft(false);
        return;
      }
      insertData.patient_mrn = null;
      insertData.patient_dob = null;
      insertData.patient_age_years = Number(patientAgeYears) || null;
      insertData.patient_hash = hash || '';
    } else {
      insertData.patient_mrn = patientMrn || null;
      insertData.patient_dob = patientDob || null;
      insertData.patient_age_years = null;
      insertData.patient_hash = null;
    }
    const { error } = await supabase.from('case_entries').insert(insertData);
    if (error) { setErrors([error.message]); setSavingDraft(false); return; }
    toast.show('Draft saved — you can continue editing from My Cases', 'success');
    router.push(`/${tenantSlug}/cases`);
  }

  async function handleSubmit() {
    setErrors([]);
    const parsedAge = Number(patientAgeYears);
    const payload: Record<string, unknown> = isDeidentified
      ? { template_id: selectedTemplateId, patient_age_years: parsedAge, patient_hash: '', case_date: caseDate, field_values: fieldValues, accreditation_mappings: accreditationMappings, is_deidentified: true as const }
      : { template_id: selectedTemplateId, patient_mrn: patientMrn, patient_dob: patientDob, case_date: caseDate, field_values: fieldValues, accreditation_mappings: accreditationMappings, is_deidentified: false as const };
    const result = caseEntrySchema.safeParse(payload);
    if (!result.success) { setErrors(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)); return; }
    setLoading(true);
    const insertData: Record<string, unknown> = {
      tenant_id: tenantId, template_id: selectedTemplateId, case_date: caseDate, field_values: fieldValues,
      status: initialStatus, accreditation_mappings: accreditationMappings, is_deidentified: isDeidentified,
    };
    if (isDeidentified) {
      const mrnForHash = patientMrn || `temp-${Date.now()}`;
      const { data: hash, error: hashError } = await supabase.rpc('hash_patient_mrn', {
        p_mrn: mrnForHash,
        p_tenant_id: tenantId,
      });
      if (hashError) {
        setErrors(['Failed to generate patient hash. Please try again.']);
        setLoading(false);
        return;
      }
      insertData.patient_mrn = null; insertData.patient_dob = null; insertData.patient_age_years = parsedAge; insertData.patient_hash = hash || '';
    } else {
      insertData.patient_mrn = patientMrn; insertData.patient_dob = patientDob; insertData.patient_age_years = null; insertData.patient_hash = null;
    }
    const { data: inserted, error } = await supabase.from('case_entries').insert(insertData).select('id').single();
    if (error) { setErrors([error.message]); setLoading(false); return; }
    setSubmittedCaseId((inserted as { id: string })?.id || null);
    setSubmitted(true);
    setLoading(false);
    setConfirmSubmit(false);
    toast.show('Case logged successfully', 'success');
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (confirmSubmit) { if (e.key === 'Escape') setConfirmSubmit(false); return; }
      if (submitted) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setSubmitted(false); setSubmittedCaseId(null); setStep(0); setSelectedTemplateId('');
          setFieldValues({}); setIsDeidentified(false); setPatientMrn(''); setPatientDob('');
          setPatientAgeYears(''); setCaseDate(''); setAccreditationMappings([]); setErrors([]);
        }
        return;
      }
      const target = e.target as HTMLElement;
      const isTextArea = target.tagName === 'TEXTAREA';
      if (e.key === 'Enter' && !e.shiftKey && !isTextArea) {
        e.preventDefault();
        if (step < STEPS.length - 1 && canProceed(step)) { setErrors([]); setStep(prev => prev + 1); }
        else if (step === STEPS.length - 1) setConfirmSubmit(true);
      }
      if (e.key === 'Escape' && step > 0) { setErrors([]); setStep(prev => prev - 1); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [step, confirmSubmit, submitted, canProceed]);

  return (
    <div className="glass-panel p-6">
      {!submitted && <StepIndicator currentStep={step} steps={STEPS} />}

      {errors.length > 0 && (
        <div className="mb-4">
          {errors.map((err, i) => <ErrorDisplay key={i} message={err} />)}
        </div>
      )}

      {submitted ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
          className="text-center py-8 space-y-5"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-approved/10 border border-approved/30">
            <svg className="w-8 h-8 text-approved" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-xl font-heading font-bold mb-1">Case Logged Successfully</h3>
            <p className="text-sm text-neutral-light/50">Your case has been saved and is now visible in your logbook.</p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            {submittedCaseId && (
              <a href={`/${tenantSlug}/cases/${submittedCaseId}`} className="px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-neutral-light hover:border-primary hover:text-primary transition-colors">
                View Case
              </a>
            )}
            <a href={`/${tenantSlug}/cases`} className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              Go to My Cases
            </a>
          </div>
          <p className="text-xs text-neutral-light/50 pt-2">
            Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-dark border border-border text-xs">Enter</kbd> to log another case
          </p>
        </motion.div>
      ) : (
        <>
          <AnimatePresence mode="wait">
            <motion.div key={step} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeInOut' }}>
              {step === 0 && (
                <TemplateStep
                  templates={templates}
                  selectedTemplateId={selectedTemplateId}
                  onSelect={(id) => { setSelectedTemplateId(id); setFieldValues({}); }}
                  fieldCount={fields.length}
                />
              )}
              {step === 1 && (
                <PatientInfoStep
                  isDeidentified={isDeidentified}
                  patientMrn={patientMrn}
                  patientDob={patientDob}
                  patientAgeYears={patientAgeYears}
                  onIsDeidentifiedChange={setIsDeidentified}
                  onMrnChange={setPatientMrn}
                  onDobChange={setPatientDob}
                  onAgeChange={setPatientAgeYears}
                />
              )}
              {step === 2 && (
                <CaseDetailsStep
                  template={selectedTemplate}
                  fieldValues={fieldValues}
                  caseDate={caseDate}
                  onCaseDateChange={setCaseDate}
                  onFieldChange={handleFieldChange}
                  getFieldKey={getFieldKey}
                />
              )}
              {step === 3 && (
                <ReviewStep
                  template={selectedTemplate}
                  isDeidentified={isDeidentified}
                  patientMrn={patientMrn}
                  patientDob={patientDob}
                  patientAgeYears={patientAgeYears}
                  fieldValues={fieldValues}
                  caseDate={caseDate}
                  getFieldKey={getFieldKey}
                />
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between mt-6 pt-4 border-t border-border">
            <Button variant="ghost" onPress={handleBack} isDisabled={step === 0}>Back</Button>
            <div className="flex gap-3">
              {step >= 2 && selectedTemplateId && !submitted && (
                <Button variant="ghost" onPress={handleSaveDraft} isDisabled={savingDraft}>Save Draft</Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button variant="primary" onPress={handleNext} isDisabled={!canProceed(step)}>Continue</Button>
              ) : (
                <Button variant="primary" onPress={() => setConfirmSubmit(true)} isDisabled={loading}>Submit Case</Button>
              )}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmSubmit}
        isDeidentified={isDeidentified}
        caseDate={caseDate}
        template={selectedTemplate}
        loading={loading}
        onConfirm={handleSubmit}
        onCancel={() => setConfirmSubmit(false)}
      />
    </div>
  );
}