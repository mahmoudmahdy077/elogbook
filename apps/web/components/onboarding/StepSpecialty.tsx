'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

const COMMON_SPECIALTIES = [
  'Internal Medicine',
  'General Surgery',
  'Pediatrics',
  'Obstetrics & Gynecology',
  'Emergency Medicine',
  'Family Medicine',
  'Anesthesiology',
  'Radiology',
  'Pathology',
  'Psychiatry',
  'Neurology',
  'Orthopedic Surgery',
  'Ophthalmology',
  'Dermatology',
  'Urology',
  'Otolaryngology',
  'Cardiology',
  'Gastroenterology',
  'Pulmonology',
  'Nephrology',
  'Endocrinology',
  'Rheumatology',
  'Oncology',
  'Infectious Disease',
  'Critical Care',
  'Neonatology',
  'Sports Medicine',
  'Physical Medicine & Rehabilitation',
  'Other',
];

interface StepSpecialtyProps {
  initialSpecialty: string | null;
  onComplete: (specialty: string) => void;
}

export default function StepSpecialty({ initialSpecialty, onComplete }: StepSpecialtyProps) {
  const [selected, setSelected] = useState(initialSpecialty || '');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [customSpecialties, setCustomSpecialties] = useState<string[]>([]);
  const supabase = createClient();

  useEffect(() => {
    // Fetch any custom specialties already used in this tenant for suggestions
    supabase
      .from('case_templates')
      .select('specialty')
      .not('specialty', 'is', null)
      .then(({ data }) => {
        if (data) {
          const seen = new Set<string>();
          const extra: string[] = [];
          for (const row of data) {
            if (row.specialty && !COMMON_SPECIALTIES.includes(row.specialty) && !seen.has(row.specialty)) {
              seen.add(row.specialty);
              extra.push(row.specialty);
            }
          }
          setCustomSpecialties(extra);
        }
      });
  }, [supabase]);

  const handleSubmit = () => {
    const value = selected === 'Other' ? custom.trim() : selected;
    if (!value) {
      setError('Please select or enter your specialty.');
      return;
    }
    setError('');
    onComplete(value);
  };

  const allSpecialties = [...COMMON_SPECIALTIES, ...customSpecialties.filter((s) => !COMMON_SPECIALTIES.includes(s))];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">
          What&apos;s your specialty?
        </h2>
        <p className="text-text-muted mt-2 text-sm max-w-md mx-auto">
          Select your primary clinical specialty. This helps us tailor the case templates and milestones for you.
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
          {allSpecialties.map((spec) => (
            <button
              key={spec}
              onClick={() => { setSelected(spec); setError(''); setCustom(''); }}
              className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                selected === spec
                  ? 'bg-primary/10 text-primary border-2 border-primary/30'
                  : 'bg-white dark:bg-neutral-dark border-2 border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
              }`}
            >
              {spec}
            </button>
          ))}
        </div>

        {selected === 'Other' && (
          <div>
            <label htmlFor="custom-specialty" className="block text-sm font-medium text-text-primary mb-1.5">
              Enter your specialty
            </label>
            <input
              id="custom-specialty"
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g., Interventional Cardiology"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white dark:bg-neutral-dark text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm"
              autoFocus
            />
          </div>
        )}

        {error && (
          <p className="text-xs text-danger text-center">{error}</p>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={!selected && !custom}
          >
            Continue
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
