'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface HelpPopoverProps {
  children: React.ReactNode;
  side?: 'bottom' | 'top' | 'right';
}

export default function HelpPopover({ children, side = 'bottom' }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, close]);

  const positionClasses =
    side === 'bottom'
      ? 'top-full mt-2 left-1/2 -translate-x-1/2'
      : side === 'top'
        ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
        : 'left-full ml-2 top-1/2 -translate-y-1/2';

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-border text-neutral-light/50 hover:text-primary hover:border-primary-glow transition-colors text-xs font-medium leading-none"
        aria-label="Help"
        aria-expanded={open}
      >
        ?
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, scale: 0.95, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: side === 'top' ? 4 : -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`absolute z-50 w-72 ${positionClasses}`}
          >
            <div className="panel p-4 text-sm text-neutral-light/80 leading-relaxed shadow-lg">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
