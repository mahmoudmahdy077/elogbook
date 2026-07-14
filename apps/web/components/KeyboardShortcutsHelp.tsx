'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useShortcuts } from '@/lib/shortcuts';

const CATEGORY_ORDER = ['actions', 'navigation', 'list-navigation'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  actions: 'Actions',
  navigation: 'Navigation',
  'list-navigation': 'List Navigation',
};

export default function KeyboardShortcutsHelp() {
  const { shortcuts, setHelpOpen, modKey } = useShortcuts();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Trap focus and restore on unmount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const timer = setTimeout(() => {
      dialogRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, []);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setHelpOpen(false);
    }
  };

  // Group shortcuts by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: shortcuts.filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.3)' }}
      onClick={handleBackdropClick}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="glass-panel w-full max-w-lg max-h-[80vh] overflow-y-auto outline-none"
        style={{ padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Keyboard Shortcuts
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Press {modKey}K to open the command palette
            </p>
          </div>
          <button
            onClick={() => setHelpOpen(false)}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-text-muted hover:text-text-primary"
            aria-label="Close shortcuts"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="px-5 py-3 space-y-4">
          {grouped.map((group) => (
            <div key={group.category}>
              <h3 className="text-[0.65rem] font-semibold text-text-muted uppercase tracking-widest mb-2">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-text-primary truncate">
                        {shortcut.label}
                      </span>
                      {shortcut.description && (
                        <span className="text-xs text-text-muted hidden sm:inline truncate">
                          — {shortcut.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      {shortcut.bindings.map((binding, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5">
                          {i > 0 && (
                            <span className="text-text-muted text-xs mx-0.5">or</span>
                          )}
                          <kbd
                            className="inline-flex items-center gap-0.5 h-6 px-1.5 rounded-md text-[0.65rem] font-semibold tracking-tight"
                            style={{
                              background: 'var(--color-surface-solid)',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {renderBindingKeys(binding, modKey)}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer — sequence hint */}
        <div className="px-5 py-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              <span className="font-semibold">G</span> then a letter to navigate quickly
            </span>
            <span className="text-[0.6rem] text-text-muted">
              Press <kbd className="inline-flex items-center justify-center min-w-[18px] h-5 px-1 rounded text-[0.55rem] font-semibold" style={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)' }}>?</kbd> to toggle this dialog
            </span>
          </div>
        </div>

        {/* Pill close button */}
        <div className="flex justify-center pb-4">
          <button
            onClick={() => setHelpOpen(false)}
            className="px-5 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: 'var(--color-primary)',
              color: '#fff',
            }}
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );

  return typeof window !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}

function renderBindingKeys(
  binding: { key: string; ctrlOrCmd?: boolean; shift?: boolean; alt?: boolean },
  modKey: string,
) {
  const parts: React.ReactNode[] = [];
  if (binding.ctrlOrCmd) {
    parts.push(
      <span key="mod" className="text-[0.55rem] opacity-70">
        {modKey}
      </span>,
    );
  }
  if (binding.shift) {
    parts.push(
      <span key="shift" className="text-[0.55rem] opacity-70">
        ⇧
      </span>,
    );
  }
  if (binding.alt) {
    parts.push(
      <span key="alt" className="text-[0.55rem] opacity-70">
        ⌥
      </span>,
    );
  }
  parts.push(
    <span key="key" className="text-[0.65rem]">
      {binding.key.length === 1 ? binding.key.toUpperCase() : binding.key}
    </span>,
  );
  return <>{parts}</>;
}
