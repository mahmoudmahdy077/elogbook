'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface Milestone {
  id: string;
  sub_competency: string;
  description: string | null;
  level_1_label: string | null;
  level_2_label: string | null;
  level_3_label: string | null;
  level_4_label: string | null;
  level_5_label: string | null;
  specialty: string | null;
}

interface EpaMapping {
  id: string;
  milestone_id: string;
  epa_name: string;
  epa_description: string | null;
  required_level: number;
}

interface MilestonesMatrixProps {
  milestones: Milestone[];
  epaMappings: EpaMapping[];
  currentLevels?: Record<string, number>;
  residentId?: string;
  tenantId?: string;
  isEditable?: boolean;
}

const LEVEL_LABELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];

export default function MilestonesMatrix({
  milestones,
  epaMappings,
  currentLevels = {},
  residentId,
  tenantId,
  isEditable = false,
}: MilestonesMatrixProps) {
  const supabase = createClient();
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(
    null
  );
  const [selectedLevel, setSelectedLevel] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const epaMapByMilestone = epaMappings.reduce<Record<string, EpaMapping[]>>(
    (acc, epa) => {
      if (!acc[epa.milestone_id]) acc[epa.milestone_id] = [];
      acc[epa.milestone_id].push(epa);
      return acc;
    },
    {}
  );

  async function handleSaveAssessment() {
    if (!residentId || !selectedMilestone || selectedLevel < 1) return;

    setSaving(true);
    setError(null);

    const { error: upsertError } = await supabase
      .from('milestone_assessments')
      .upsert(
        {
          resident_id: residentId,
          milestone_id: selectedMilestone.id,
          current_level: selectedLevel,
          assessed_at: new Date().toISOString(),
        },
        {
          onConflict: 'resident_id,milestone_id',
          ignoreDuplicates: false,
        }
      );

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSelectedMilestone(null);
    setSelectedLevel(0);
  }

  function handleCellClick(milestone: Milestone) {
    if (!isEditable) return;
    setSelectedMilestone(milestone);
    setSelectedLevel(currentLevels[milestone.id] || 0);
    setError(null);
  }

  return (
    <div className="space-y-4">
      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[800px] bg-surface-solid rounded-2xl border border-border overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[200px_repeat(5,1fr)_100px] border-b border-border bg-neutral-dark">
            <div className="px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
              Sub-Competency
            </div>
            {LEVEL_LABELS.map((label, i) => (
              <div
                key={label}
                className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider border-l border-border"
              >
                <span>{label}</span>
                {milestones[0] && (
                  <span className="block text-[10px] font-normal text-text-muted mt-0.5">
                    {milestones[0][`level_${i + 1}_label` as keyof Milestone] as string ?? ''}
                  </span>
                )}
              </div>
            ))}
            <div className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider border-l border-border">
              EPA
            </div>
          </div>

          {/* Body rows */}
          <div className="divide-y divide-border">
            {milestones.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No milestones defined.
              </div>
            ) : (
              milestones.map((milestone) => {
                const currentLevel = currentLevels[milestone.id] || 0;
                const milestoneEpas = epaMapByMilestone[milestone.id] || [];

                return (
                  <div
                    key={milestone.id}
                    className="grid grid-cols-[200px_repeat(5,1fr)_100px] hover:bg-black/[0.02] transition-colors"
                  >
                    {/* Sub-competency label */}
                    <div className="px-4 py-3 flex items-center">
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {milestone.sub_competency}
                        </p>
                        {milestone.description && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                            {milestone.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Level circles (1-5) */}
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className="px-3 py-3 flex items-center justify-center border-l border-border"
                      >
                        <button
                          type="button"
                          onClick={() => handleCellClick(milestone)}
                          disabled={!isEditable}
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                            level === currentLevel
                              ? 'bg-primary text-white scale-110'
                              : level < currentLevel
                                ? 'bg-primary/30 text-primary'
                                : 'bg-neutral-dark border border-border text-text-muted'
                          } ${isEditable ? 'cursor-pointer hover:scale-125' : 'cursor-default'}`}
                          title={
                            isEditable
                              ? `Click to set ${milestone.sub_competency} to ${LEVEL_LABELS[level - 1]}`
                              : milestone[
                                  `level_${level}_label` as keyof Milestone
                                ] as string ?? LEVEL_LABELS[level - 1]
                          }
                        >
                          <span className="text-[10px] font-bold">{level}</span>
                        </button>
                      </div>
                    ))}

                    {/* EPA column */}
                    <div className="px-3 py-3 flex items-center justify-center border-l border-border">
                      {milestoneEpas.length > 0 ? (
                        <div className="text-center">
                          <span className="inline-flex items-center bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                            {milestoneEpas.length} EPA
                          </span>
                          <div className="text-[9px] text-text-muted mt-0.5">
                            Req: {milestoneEpas[0].required_level}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-text-muted">—</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Assessment Entry Modal */}
      <AnimatePresence>
        {selectedMilestone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
            onClick={() => setSelectedMilestone(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md glass-panel p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  {selectedMilestone.sub_competency}
                </h3>
                {selectedMilestone.description && (
                  <p className="text-sm text-text-muted mt-1">
                    {selectedMilestone.description}
                  </p>
                )}
              </div>

              {error && <ErrorDisplay message={error} />}

              <div className="space-y-3">
                <label className="block text-sm font-medium text-text-secondary">
                  Current Level
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSelectedLevel(level)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${
                        selectedLevel === level
                          ? 'bg-primary text-white'
                          : 'bg-neutral-dark border border-border text-text-secondary hover:border-primary'
                      }`}
                    >
                      <div className="text-lg font-bold">{level}</div>
                      <div className="text-[10px] mt-0.5">
                        {selectedMilestone[
                          `level_${level}_label` as keyof Milestone
                        ] as string ?? LEVEL_LABELS[level - 1]}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedMilestone(null)}
                  className="flex-1 rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAssessment}
                  disabled={saving || selectedLevel < 1}
                  className={`flex-1 rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium transition-opacity ${
                    saving || selectedLevel < 1
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:opacity-90'
                  }`}
                >
                  {saving ? 'Saving...' : 'Save Assessment'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
