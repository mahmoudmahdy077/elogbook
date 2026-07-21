'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface Template {
  specialty: string;
  name: string;
}

interface ConfirmDialogProps {
  isOpen: boolean;
  isDeidentified: boolean;
  caseDate: string;
  template: Template | undefined;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const { isOpen, isDeidentified, caseDate, template, loading, onConfirm, onCancel } = props;
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);

  const templateStr = template
    ? `Template: ${template.specialty} — ${template.name}`
    : '';
  const mode = isDeidentified ? 'De-identified' : 'PII';
  const date = caseDate || '-';
  const impact = `${templateStr} | Mode: ${mode} | Date: ${date}`;

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      const firstFocusable = dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onCancel}
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="glass-panel p-6 max-w-md w-full"
          >
            <h3
              id="confirm-dialog-title"
              className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans mb-3"
            >
              Confirm Submission
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              You are about to submit this case entry. Please verify the information below is correct.
            </p>

            <div className="bg-black/[0.03] rounded-xl p-3 mb-4 text-sm border border-border">
              <span className="text-text-secondary">{impact}</span>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full bg-black/5 text-text-secondary px-4 py-2.5 text-sm font-medium hover:bg-black/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Submitting...' : 'Confirm & Submit'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
