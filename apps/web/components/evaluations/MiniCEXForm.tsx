'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface MiniCEXFormProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  residentId: string;
  evaluatorId: string;
}

const DOMAINS: { key: string; label: string }[] = [
  { key: 'medical_interview', label: 'Medical Interview' },
  { key: 'physical_exam', label: 'Physical Exam' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'clinical_judgment', label: 'Clinical Judgment' },
  { key: 'counseling', label: 'Counseling & Communication' },
  { key: 'organization', label: 'Organization & Efficiency' },
  { key: 'overall', label: 'Overall Clinical Competence' },
];

const RATING_LABELS: Record<number, string> = {
  1: 'Unsatisfactory',
  2: '',
  3: 'Satisfactory',
  4: '',
  5: 'Good',
  6: '',
  7: 'Excellent',
  8: '',
  9: 'Superior',
};

export default function MiniCEXForm({
  isOpen,
  onClose,
  tenantId,
  residentId,
  evaluatorId,
}: MiniCEXFormProps) {
  const supabase = createClient();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRating(key: string, value: number) {
    setRatings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate all domains rated
    const missing = DOMAINS.filter((d) => !ratings[d.key]);
    if (missing.length > 0) {
      setError(
        `Please rate all domains: ${missing.map((d) => d.label).join(', ')}`
      );
      return;
    }

    setSaving(true);

    const totalScore = Object.values(ratings).reduce((sum, r) => sum + r, 0);

    const { error: insertError } = await supabase
      .from('evaluation_forms')
      .insert({
        tenant_id: tenantId,
        resident_id: residentId,
        evaluator_id: evaluatorId,
        form_type: 'Mini-CEX',
        domains: ratings,
        total_score: totalScore,
        evaluator_notes: notes || null,
        completed_at: new Date().toISOString(),
      });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-xl glass-panel p-6 my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Mini-CEX Evaluation
                </h2>
                <p className="text-sm text-text-muted">
                  Rate each domain from 1 (Unsatisfactory) to 9 (Superior)
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 hover:bg-neutral-dark transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5 text-text-muted"
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
            </div>

            {error && <ErrorDisplay message={error} />}

            <form onSubmit={handleSubmit} className="space-y-5">
              {DOMAINS.map((domain) => (
                <div key={domain.key}>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    {domain.label}
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((rating) => (
                      <button
                        key={rating}
                        type="button"
                        onClick={() => setRating(domain.key, rating)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                          ratings[domain.key] === rating
                            ? 'bg-primary text-white'
                            : 'bg-neutral-dark border border-border text-text-secondary hover:border-primary'
                        }`}
                        title={RATING_LABELS[rating] || ''}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                  {ratings[domain.key] && RATING_LABELS[ratings[domain.key]] && (
                    <p className="text-xs text-text-muted mt-1">
                      {RATING_LABELS[ratings[domain.key]]}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Additional observations or feedback..."
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium transition-opacity ${
                    saving
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:opacity-90'
                  }`}
                >
                  {saving ? 'Submitting...' : 'Submit Evaluation'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
