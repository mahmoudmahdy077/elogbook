'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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

interface Template {
  id: string;
  name: string;
  specialty: string;
  fields: TemplateField[];
}

interface QuickAddCaseProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenantSlug: string;
}

const inputBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const textareaBase =
  'w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary min-h-[80px] resize-y';

function getFieldKey(f: TemplateField): string {
  return f.key || f.name || '';
}

export default function QuickAddCase({ isOpen, onClose, onSaved, tenantSlug }: QuickAddCaseProps) {
  const [supabase] = useState(() => createClient());
  const { show: showToast } = useToast();
  const prefersReduced = useReducedMotion();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [caseDate, setCaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [isDeidentified, setIsDeidentified] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingTemplates(false); return; }
    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).single();
    if (!profile) { setLoadingTemplates(false); return; }
    
    // Fetch both tenant-specific AND global templates
    const [tenantRes, globalRes] = await Promise.all([
      supabase.from('case_templates').select('id, name, specialty, fields').eq('tenant_id', profile.tenant_id).order('name'),
      supabase.from('case_templates').select('id, name, specialty, fields').eq('tenant_id', '00000000-0000-0000-0000-000000000000').order('name'),
    ]);
    
    const allTemplates = [...(tenantRes.data || []), ...(globalRes.data || [])];
    setTemplates(allTemplates as Template[]);
    setLoadingTemplates(false);
  }, [supabase]);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setErrors([]);
    }
  }, [isOpen, fetchTemplates]);

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setSelectedTemplateId('');
    setPatientMrn('');
    setPatientDob('');
    setCaseDate(new Date().toISOString().split('T')[0]);
    setFieldValues({});
    setIsDeidentified(true);
    setErrors([]);
  }

  async function handleSave(close: boolean) {
    setErrors([]);
    if (!selectedTemplateId) {
      setErrors(['Please select a template.']);
      return;
    }
    if (!isDeidentified && !patientMrn.trim()) {
      setErrors(['Patient MRN is required when not de-identified.']);
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErrors(['Not authenticated.']); setSaving(false); return; }
    const { data: profile } = await supabase.from('profiles').select('id, tenant_id').eq('user_id', user.id).single();
    if (!profile) { setErrors(['Profile not found.']); setSaving(false); return; }

    const insertData: Record<string, unknown> = {
      tenant_id: profile.tenant_id,
      resident_id: profile.id,
      template_id: selectedTemplateId,
      case_date: caseDate,
      field_values: fieldValues,
      status: 'approved',
      is_deidentified: isDeidentified,
    };

    if (isDeidentified) {
      const mrnForHash = patientMrn || `temp-${Date.now()}`;
      const { data: hash, error: hashError } = await supabase.rpc('hash_patient_mrn', {
        p_mrn: mrnForHash,
        p_tenant_id: profile.tenant_id,
      });
      if (hashError) {
        setErrors(['Failed to generate patient hash. Please try again.']);
        setSaving(false);
        return;
      }
      insertData.patient_mrn = null;
      insertData.patient_dob = null;
      insertData.patient_hash = hash || '';
    } else {
      insertData.patient_mrn = patientMrn || null;
      insertData.patient_dob = patientDob || null;
      insertData.patient_hash = null;
    }

    const { error } = await supabase.from('case_entries').insert(insertData);
    if (error) {
      setErrors([error.message]);
      setSaving(false);
      return;
    }

    showToast('Draft saved', 'success');
    if (close) {
      resetForm();
      onClose();
      onSaved();
    } else {
      resetForm();
    }
    setSaving(false);
  }

  const slideVariants = {
    enter: { x: '100%' },
    center: { x: 0 },
    exit: { x: '100%' },
  };

  const backdropVariants = {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="quickadd-backdrop"
            variants={backdropVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="quickadd-panel"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={prefersReduced ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-surface-solid border-l border-border shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em]">Quick Add Case</h2>
              <button
                onClick={() => { resetForm(); onClose(); }}
                className="p-1.5 rounded-lg hover:bg-neutral-dark transition-colors text-text-muted"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {errors.length > 0 && (
                <div className="rounded-xl bg-danger/10 border border-danger/20 px-4 py-3 text-sm text-danger">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}

              {/* Template selector */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-primary">
                  Template<span className="text-danger ml-0.5">*</span>
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => { setSelectedTemplateId(e.target.value); setFieldValues({}); }}
                  aria-label="Select template"
                  className={inputBase + ' appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%238E8E93%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10'}
                >
                  <option value="" disabled>
                    {loadingTemplates ? 'Loading...' : 'Select template'}
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.specialty} — {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* De-identify toggle */}
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="quickadd-deidentify"
                  checked={isDeidentified}
                  onChange={(e) => setIsDeidentified(e.target.checked)}
                  className="h-4 w-4 rounded border-black/20 text-primary focus:ring-primary accent-primary"
                />
                <label htmlFor="quickadd-deidentify" className="text-sm text-text-secondary">
                  De-identify patient
                </label>
              </div>

              {/* MRN (only when not de-identified) */}
              {!isDeidentified && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-text-primary">
                    Patient MRN<span className="text-danger ml-0.5">*</span>
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
              )}

              {/* DOB (only when not de-identified) */}
              {!isDeidentified && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-text-primary">Patient DOB</label>
                  <input
                    type="date"
                    value={patientDob}
                    onChange={(e) => setPatientDob(e.target.value)}
                    aria-label="Patient date of birth"
                    className={inputBase}
                  />
                </div>
              )}

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

              {/* Dynamic template fields */}
              {selectedTemplate && (selectedTemplate.fields || []).length > 0 && (
                <div className="border-t border-border pt-4 mt-2">
                  <h4 className="text-sm font-semibold text-text-primary mb-3">Template Fields</h4>
                  <div className="space-y-3">
                    {selectedTemplate.fields.map((field) => {
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
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                aria-label={label}
                                className={textareaBase}
                              />
                            </div>
                          );
                        case 'select':
                          return (
                            <div key={key} className="space-y-1.5">
                              <label className="block text-sm font-medium text-text-primary">{label}</label>
                              <select
                                value={(fieldValues[key] as string) || ''}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                aria-label={`Select ${label}`}
                                className={inputBase + ' appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%238E8E93%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.25rem_1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10'}
                              >
                                <option value="" disabled>Select {label.toLowerCase()}</option>
                                {options.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                          );
                        case 'number':
                          return (
                            <div key={key} className="space-y-1.5">
                              <label className="block text-sm font-medium text-text-primary">{label}</label>
                              <input
                                type="number"
                                value={(fieldValues[key] as string) || ''}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
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
                                onChange={(e) => handleFieldChange(key, e.target.value)}
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
                                id={`quickadd-field-${key}`}
                                checked={!!fieldValues[key]}
                                onChange={(e) => handleFieldChange(key, e.target.checked)}
                                className="h-4 w-4 rounded border-black/20 text-primary focus:ring-primary accent-primary"
                                aria-label={label}
                              />
                              <label htmlFor={`quickadd-field-${key}`} className="text-sm text-text-secondary">
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
                                onChange={(e) => handleFieldChange(key, e.target.value)}
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
              {selectedTemplate && (selectedTemplate.fields || []).length === 0 && (
                <p className="text-sm text-text-muted italic">
                  No fields defined for this template.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-full text-sm font-medium bg-neutral-dark text-text-primary hover:bg-neutral transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & New'}
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-full text-sm font-medium bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Close'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
