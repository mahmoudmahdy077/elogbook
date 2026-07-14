'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useShortcuts } from '@/lib/shortcuts';

export default function CommandPalette() {
  const { paletteItems, setPaletteOpen, modKey } = useShortcuts();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, []);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return paletteItems;
    const q = query.toLowerCase().trim();
    return paletteItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.shortcut?.toLowerCase().includes(q),
    );
  }, [paletteItems, query]);

  // Reset active index when filter changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = filteredItems[index];
      if (item) {
        item.onSelect();
        setPaletteOpen(false);
      }
    },
    [filteredItems, setPaletteOpen],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < filteredItems.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : filteredItems.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(activeIndex);
          break;
        case 'Escape':
          e.preventDefault();
          setPaletteOpen(false);
          break;
      }
    },
    [filteredItems.length, activeIndex, handleSelect, setPaletteOpen],
  );

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setPaletteOpen(false);
    }
  };

  const content = (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] p-4"
      style={{ background: 'rgba(0, 0, 0, 0.3)' }}
      onClick={handleBackdropClick}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="glass-panel w-full max-w-md overflow-hidden outline-none"
        style={{ padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            className="w-4 h-4 text-text-muted shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none border-none"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search commands"
          />
          <kbd
            className="hidden sm:inline-flex items-center justify-center h-5 px-1.5 rounded text-[0.55rem] font-semibold shrink-0"
            style={{
              background: 'var(--color-surface-solid)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            {modKey}K
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto"
          style={{ maxHeight: 'min(50vh, 320px)' }}
          role="listbox"
          aria-label="Commands"
        >
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-text-muted">
                {query
                  ? `No command matching "${query}"`
                  : 'No commands available'}
              </p>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  index === activeIndex
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium text-text-muted uppercase shrink-0 w-16 text-right tabular-nums">
                    {item.category === 'Actions' ? (
                      <span className="text-primary/60">⌘</span>
                    ) : item.category === 'Navigation' ? (
                      <span className="text-secondary/60">↗</span>
                    ) : (
                      <span className="text-text-muted">↕</span>
                    )}
                  </span>
                  <span
                    className={`text-sm truncate ${
                      index === activeIndex ? 'font-medium' : ''
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
                {item.shortcut && (
                  <span
                    className="text-[0.6rem] font-semibold text-text-muted shrink-0 ml-3"
                    style={{
                      background: 'var(--color-surface-solid)',
                      border: '1px solid var(--color-border)',
                      padding: '1px 5px',
                      borderRadius: '4px',
                    }}
                  >
                    {item.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[0.6rem] text-text-muted">
              <kbd
                className="inline-flex items-center justify-center h-4 px-1 rounded text-[0.5rem] font-semibold"
                style={{
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border)',
                }}
              >
                ↑↓
              </kbd>
              navigate
            </span>
            <span className="flex items-center gap-1 text-[0.6rem] text-text-muted">
              <kbd
                className="inline-flex items-center justify-center h-4 px-1 rounded text-[0.5rem] font-semibold"
                style={{
                  background: 'var(--color-surface-solid)',
                  border: '1px solid var(--color-border)',
                }}
              >
                ↵
              </kbd>
              select
            </span>
          </div>
          <span className="flex items-center gap-1 text-[0.6rem] text-text-muted">
            <kbd
              className="inline-flex items-center justify-center h-4 px-1 rounded text-[0.5rem] font-semibold"
              style={{
                background: 'var(--color-surface-solid)',
                border: '1px solid var(--color-border)',
              }}
            >
              esc
            </kbd>
            close
          </span>
        </div>
      </motion.div>
    </div>
  );

  return typeof window !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}
