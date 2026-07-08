'use client';

import { motion } from 'framer-motion';

type FormType = 'Mini-CEX' | 'DOPS' | 'CBD';

interface EvaluationFormPickerProps {
  onSelect: (formType: FormType) => void;
  selectedType?: FormType | null;
}

const FORM_TYPES: {
  type: FormType;
  title: string;
  description: string;
  domains: number;
  icon: React.ReactNode;
}[] = [
  {
    type: 'Mini-CEX',
    title: 'Mini-CEX',
    description:
      'Mini Clinical Evaluation Exercise — assess clinical encounters across 7 domains rated 1-9.',
    domains: 7,
    icon: (
      <svg
        className="w-8 h-8 text-primary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    type: 'DOPS',
    title: 'DOPS',
    description:
      'Direct Observation of Procedural Skills — assess procedural competency across 11 domains rated 1-6.',
    domains: 11,
    icon: (
      <svg
        className="w-8 h-8 text-secondary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    type: 'CBD',
    title: 'CBD',
    description:
      'Case-Based Discussion — assess clinical reasoning across 6 domains rated 1-5 entrustment.',
    domains: 6,
    icon: (
      <svg
        className="w-8 h-8 text-approved"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="14" y2="11" />
        <line x1="8" y1="15" x2="12" y2="15" />
      </svg>
    ),
  },
];

export default function EvaluationFormPicker({
  onSelect,
  selectedType,
}: EvaluationFormPickerProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {FORM_TYPES.map((form) => {
        const isSelected = selectedType === form.type;
        return (
          <motion.button
            key={form.type}
            type="button"
            onClick={() => onSelect(form.type)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`text-left glass-panel p-5 space-y-3 cursor-pointer transition-all ${
              isSelected
                ? 'ring-2 ring-primary border-primary'
                : 'hover:border-primary/50'
            }`}
          >
            <div className="flex items-center gap-3">
              {form.icon}
              <div>
                <h3 className="font-semibold text-text-primary">{form.title}</h3>
                <p className="text-xs text-text-muted">
                  {form.domains} domains
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              {form.description}
            </p>
          </motion.button>
        );
      })}
    </div>
  );
}
