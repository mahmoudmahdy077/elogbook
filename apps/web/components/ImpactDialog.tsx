'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '@heroui/react';
import { useEffect, useRef } from 'react';

export interface ImpactDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  impact?: string;
  severity: 'info' | 'warning' | 'danger';
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const SEVERITY_STYLES: Record<string, { button: string; accent: string }> = {
  info: { button: 'primary', accent: 'border-teal-500/30' },
  warning: { button: 'secondary', accent: 'border-amber-500/30' },
  danger: { button: 'danger', accent: 'border-red-500/30' },
};

const SEVERITY_HEADER: Record<string, string> = {
  info: 'text-teal-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
};

export default function ImpactDialog({
  isOpen,
  title,
  message,
  impact,
  severity,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
}: ImpactDialogProps) {
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

  const styles = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  const headerColor = SEVERITY_HEADER[severity] ?? SEVERITY_HEADER.info;

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
            aria-labelledby="impact-dialog-title"
            className={`panel p-6 max-w-md w-full shadow-xl border ${styles.accent}`}
          >
            <h3 id="impact-dialog-title" className={`text-lg font-semibold font-heading mb-3 ${headerColor}`}>
              {title}
            </h3>
            <p className="text-sm text-neutral-light/80 mb-4">{message}</p>

            {impact && (
              <div className="bg-neutral-dark/50 rounded-lg p-3 mb-4 text-sm border border-neutral-light/10">
                <span className="text-neutral-light">{impact}</span>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onPress={onCancel}>
                Cancel
              </Button>
              <Button variant={styles.button as 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost' | 'danger-soft' | 'tertiary'} onPress={onConfirm} isDisabled={loading}>
                {loading ? 'Loading...' : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
