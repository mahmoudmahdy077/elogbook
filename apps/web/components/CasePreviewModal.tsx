'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { StatusBadge } from '@elogbook/shared/components/web';
import ErrorDisplay from './ErrorDisplay';

interface TemplateField {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface CaseDetail {
  id: string;
  case_date: string;
  status: string;
  is_deidentified: boolean;
  patient_mrn: string | null;
  patient_dob: string | null;
  field_values: Record<string, unknown>;
  profiles: { full_name: string; specialty: string | null }[];
  case_templates: { name: string; specialty: string; fields: TemplateField[] }[];
  approval_requests: { id: string; status: string; comment: string | null; requested_at: string }[];
}

interface Props {
  isOpen: boolean;
  entryId: string | null;
  tenantSlug: string;
  onClose: () => void;
}

export default function CasePreviewModal({ isOpen, entryId, tenantSlug, onClose }: Props) {
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const fetchCase = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchErr } = await supabase
      .from('case_entries')
      .select(`
        id, case_date, status, is_deidentified, patient_mrn, patient_dob, field_values,
        profiles:resident_id(full_name, specialty),
        case_templates:template_id(name, specialty, fields),
        approval_requests(id, status, comment, requested_at)
      `)
      .eq('id', entryId)
      .single();

    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setCaseData(data as CaseDetail);
    }
    setLoading(false);
  }, [entryId, supabase]);

  useEffect(() => {
    if (isOpen && entryId) {
      fetchCase();
      setComment('');
      setActionError(null);
      setConfirmReject(false);
    }
  }, [isOpen, entryId, fetchCase]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!caseData) return;
    setActionLoading(action);
    setActionError(null);

    try {
      const res = await fetch(`/api/${tenantSlug}/approvals/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          entry_id: caseData.id,
          comment: comment || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'An error occurred.');
        setActionLoading(null);
        return;
      }
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error.');
      setActionLoading(null);
    }
  };

  const onRejectClick = () => {
    if (!confirmReject) {
      setConfirmReject(true);
      setActionError(null);
      return;
    }
    handleAction('reject');
  };

  const profile = caseData?.profiles?.[0];
  const template = caseData?.case_templates?.[0];
  const fields: TemplateField[] = Array.isArray(template?.fields) ? template!.fields : [];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-preview-title"
            className="relative h-full w-full max-w-lg bg-surface-solid border-l border-border flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 id="case-preview-title" className="text-base font-semibold text-text-primary truncate">
                Case Preview
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-neutral-dark transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-text-muted">Loading case details...</p>
                </div>
              )}

              {error && <ErrorDisplay message={error} onRetry={fetchCase} />}

              {caseData && !loading && (
                <>
                  {/* Status + Specialty */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={caseData.is_deidentified ? 'deidentified' : 'draft'} size="sm">
                      {caseData.is_deidentified ? 'De-ID' : 'PII'}
                    </StatusBadge>
                    <StatusBadge status={caseData.status as 'pending'} size="sm" />
                    <span className="text-xs text-text-muted">
                      {template?.specialty}
                      {template?.name ? ` — ${template.name}` : ''}
                    </span>
                  </div>

                  {/* Resident */}
                  <div>
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Resident</p>
                    <p className="text-sm font-medium text-text-primary mt-0.5">
                      {profile?.full_name || 'Unknown'}
                      {profile?.specialty ? ` (${profile.specialty})` : ''}
                    </p>
                  </div>

                  {/* Case Date */}
                  <div>
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Case Date</p>
                    <p className="text-sm font-medium text-text-primary mt-0.5">{caseData.case_date}</p>
                  </div>

                  {/* Patient Info */}
                  {!caseData.is_deidentified && (caseData.patient_mrn || caseData.patient_dob) && (
                    <div className="grid grid-cols-2 gap-4">
                      {caseData.patient_mrn && (
                        <div>
                          <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Patient MRN</p>
                          <p className="text-sm font-medium text-text-primary mt-0.5">{caseData.patient_mrn}</p>
                        </div>
                      )}
                      {caseData.patient_dob && (
                        <div>
                          <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Patient DOB</p>
                          <p className="text-sm font-medium text-text-primary mt-0.5">{caseData.patient_dob}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dynamic Template Fields */}
                  {fields.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Case Details</p>
                      <div className="space-y-0 rounded-xl border border-border overflow-hidden">
                        {fields.map((f) => (
                          <div
                            key={f.key}
                            className="flex justify-between items-start px-4 py-2.5 border-b border-border last:border-b-0 bg-surface-solid"
                          >
                            <span className="text-sm text-text-secondary">
                              {f.label}
                              {f.required && <span className="text-danger ml-0.5">*</span>}
                            </span>
                            <span className="text-sm font-medium text-text-primary text-right max-w-[60%] break-words">
                              {String((caseData.field_values as Record<string, unknown>)?.[f.key] ?? '\u2014')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Approve/Reject */}
                  <div className="border-t border-border pt-5 space-y-3">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Add feedback (recommended for reject)..."
                      rows={2}
                      aria-label="Comment"
                      className="w-full px-3 py-2 text-sm text-text-primary placeholder-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
                    />
                    {actionError && <ErrorDisplay message={actionError} />}
                    {confirmReject && (
                      <p className="text-xs text-warning" role="alert">
                        Click Reject again to confirm. This action is irreversible.
                      </p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={actionLoading !== null}
                        onClick={onRejectClick}
                        className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50 ${
                          confirmReject
                            ? 'bg-danger text-white hover:opacity-90'
                            : 'bg-danger/10 text-danger hover:bg-danger/20'
                        }`}
                      >
                        {actionLoading === 'reject' ? 'Rejecting\u2026' : confirmReject ? 'Confirm Reject' : 'Reject'}
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading !== null}
                        onClick={() => handleAction('approve')}
                        className="inline-flex items-center px-4 py-2 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                      >
                        {actionLoading === 'approve' ? 'Approving\u2026' : 'Approve'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
