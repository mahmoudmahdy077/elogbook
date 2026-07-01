'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '@heroui/react';
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

export default function ConfirmDialog({
  isOpen,
  isDeidentified,
  caseDate,
  template,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      const firstFocusable = dialogRef.current.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      firstFocusable?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
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
            className="panel p-6 max-w-md w-full shadow-xl"
          >
            <h3 id="confirm-dialog-title" className="text-lg font-semibold font-heading mb-3">Confirm Submission</h3>

            <div className="space-y-3 mb-5 text-sm">
              <p className="text-neutral-light/80">
                You are about to submit this case entry. Please verify the information below is correct.
              </p>

              <div className="bg-neutral-dark/50 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-light/50">Template</span>
                  <span className="font-medium">{template?.specialty} — {template?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-light/50">Mode</span>
                  <span className={`font-medium ${isDeidentified ? 'text-pending' : 'text-rejected'}`}>
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
              <Button variant="ghost" onPress={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" onPress={onConfirm} isDisabled={loading}>
                Confirm & Submit
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}