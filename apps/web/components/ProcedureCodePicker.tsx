'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface ProcedureCode {
  id: string;
  code: string;
  name: string;
  specialty: string | null;
  description: string | null;
}

interface ProcedureCodePickerProps {
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
  tenantId?: string;
}

export default function ProcedureCodePicker({
  selectedCodes,
  onChange,
  tenantId,
}: ProcedureCodePickerProps) {
  const supabase = createClient();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProcedureCode[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      let dbQuery = supabase
        .from('procedure_codes')
        .select('id, code, name, specialty, description')
        .textSearch('name', query.trim(), {
          type: 'websearch',
          config: 'english',
        })
        .limit(20);

      if (tenantId) {
        dbQuery = dbQuery.eq('tenant_id', tenantId);
      }

      const { data } = await dbQuery;
      setResults((data ?? []) as ProcedureCode[]);
      setIsOpen(true);
      setLoading(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, supabase, tenantId]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function addCode(code: ProcedureCode) {
    if (!selectedCodes.includes(code.id)) {
      onChange([...selectedCodes, code.id]);
    }
    setQuery('');
    setResults([]);
    setIsOpen(false);
  }

  function removeCode(codeId: string) {
    onChange(selectedCodes.filter((id) => id !== codeId));
  }

  return (
    <div ref={pickerRef} className="relative">
      {/* Selected codes */}
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedCodes.map((codeId, idx) => (
            <span
              key={codeId}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full"
            >
              <span className="font-medium">{codeId.slice(0, 8)}</span>
              <button
                type="button"
                onClick={() => removeCode(codeId)}
                className="hover:text-primary/80 transition-colors"
                aria-label={`Remove code ${idx}`}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search procedure codes..."
          className="rounded-xl bg-neutral-dark border border-border p-2.5 pl-10 w-full text-sm"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown results */}
      <AnimatePresence>
        {isOpen && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 mt-1 w-full bg-surface-solid border border-border rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto"
          >
            {results.map((code) => {
              const isSelected = selectedCodes.includes(code.id);
              return (
                <button
                  key={code.id}
                  type="button"
                  onClick={() => addCode(code)}
                  disabled={isSelected}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 text-sm hover:bg-neutral-dark transition-colors ${
                    isSelected ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <span className="inline-flex items-center bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                    {code.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary truncate font-medium">
                      {code.name}
                    </p>
                    {code.specialty && (
                      <p className="text-text-muted text-xs truncate">
                        {code.specialty}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <svg
                      className="w-4 h-4 text-approved shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}

        {isOpen && query.trim() && results.length === 0 && !loading && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 mt-1 w-full bg-surface-solid border border-border rounded-xl shadow-lg p-4 text-sm text-text-muted text-center"
          >
            No procedure codes found for &quot;{query}&quot;
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
