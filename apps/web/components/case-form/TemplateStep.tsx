'use client';

import { TemplateWithMeta } from '@elogbook/shared';
import HelpPopover from '@/components/HelpPopover';

interface TemplateStepProps {
  templates: TemplateWithMeta[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

const SPECIALTY_ICONS: Record<string, string> = {
  surgery: '🔪',
  radiology: '🔬',
  emergency: '⚡',
  internal: '❤️',
  cardiology: '💓',
  neurology: '🧠',
  orthopedics: '🦴',
  pediatrics: '👶',
  psychiatry: '💬',
  custom: '📋',
};

function getIcon(specialty: string): string {
  return SPECIALTY_ICONS[specialty.toLowerCase()] ?? '📋';
}

export default function TemplateStep({
  templates,
  selectedTemplateId,
  onSelect,
  onToggleFavorite,
}: TemplateStepProps) {
  if (templates.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold font-heading">Select Case Template</h3>
        <p className="text-sm text-neutral-light/60">No templates available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold font-heading">
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
      <p className="text-sm text-neutral-light/60">
        Choose a template for your logbook entry. Star your favorites for quick access.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => {
          const isSelected = t.id === selectedTemplateId;
          return (
            <div
              key={t.id}
              className={`relative rounded-xl p-4 border cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-teal-900/30 border-teal-500'
                  : 'bg-slate-900 border-indigo-500/15 hover:border-indigo-500/40'
              }`}
              onClick={() => onSelect(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(t.id); }}
              aria-label={`${t.specialty} - ${t.name} template`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getIcon(t.specialty)}</span>
                  <div>
                    <div className="text-white font-heading text-sm">
                      {t.specialty} — {t.name}
                    </div>
                    <div className="text-indigo-400 text-xs mt-1">
                      {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                      {t.usage_count > 0 && (
                        <span className="text-slate-500 ml-2">
                          {t.usage_count} used
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(t.id); }}
                  className={`text-lg p-1 rounded hover:bg-slate-700/50 transition-colors ${
                    t.is_favorite ? 'text-amber-400' : 'text-slate-600'
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
