'use client';

import { useState, useEffect } from 'react';
import { TemplateWithMeta } from '@elogbook/shared';
import HelpPopover from '@/components/HelpPopover';

interface TemplateStepProps {
  templates: TemplateWithMeta[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onSearch: (q: string) => void;
}

function getMonogram(specialty: string): string {
  return specialty.slice(0, 2).toUpperCase();
}

export default function TemplateStep({
  templates,
  selectedTemplateId,
  onSelect,
  onToggleFavorite,
  onSearch,
}: TemplateStepProps) {
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => onSearch(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput, onSearch]);
  if (templates.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
          Select Case Template
        </h3>
        <p className="text-sm text-text-muted">No templates available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
          Select Case Template
        </h3>
        <HelpPopover>
          <p className="mb-2">
            <strong>Templates</strong> define the fields you need to fill out for a particular type of clinical case.
          </p>
          <p className="mb-2">
            Templates are organized by <strong>specialty</strong> and <strong>case type</strong>.
          </p>
          <p>
            Your program director sets up templates that match your accreditation framework.
          </p>
        </HelpPopover>
      </div>
      <p className="text-sm text-text-muted">
        Choose a template for your logbook entry. Star your favorites for quick access.
      </p>
      <input
        type="text"
        aria-label="Search templates"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search templates..."
        className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-surface-solid text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => {
          const isSelected = t.id === selectedTemplateId;
          return (
            <div
              key={t.id}
              className={`relative rounded-2xl p-4 border cursor-pointer transition-colors duration-200 ${
                isSelected
                  ? 'bg-primary/5 border-primary'
                  : 'bg-surface-solid border-border hover:border-primary/30 hover:bg-primary/[0.02]'
              }`}
              onClick={() => onSelect(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(t.id); }}
              aria-label={`${t.specialty} - ${t.name} template`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-semibold" aria-hidden="true">{getMonogram(t.specialty)}</span>
                  <div>
                    <div className="text-text-primary font-sans font-semibold text-sm tracking-[-0.01em]">
                      {t.specialty} — {t.name}
                    </div>
                    <div className="text-text-muted text-xs mt-1">
                      {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                      {t.usage_count > 0 && (
                        <span className="text-text-muted ml-2">
                          {t.usage_count} used
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(t.id); }}
                  className={`text-lg p-1 rounded-full transition-colors ${
                    t.is_favorite
                      ? 'text-amber-400 hover:text-amber-500'
                      : 'text-text-muted hover:text-text-muted'
                  }`}
                  aria-label={t.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                  type="button"
                >
                  {t.is_favorite ? '★' : '☆'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
