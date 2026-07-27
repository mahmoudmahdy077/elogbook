'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import ErrorDisplay from '@/components/ErrorDisplay';
import ImpactDialog from '@/components/ImpactDialog';
import { createClient } from '@/lib/supabase/client';
import {
  type AccreditationFramework,
  type AccreditationMilestone,
  type FrameworkType,
  accreditationFrameworkSchema,
} from '@elogbook/shared';

interface CompetencyManagerProps {
  tenantId: string;
}

const FRAMEWORK_TYPE_OPTIONS: { key: FrameworkType; label: string }[] = [
  { key: 'acgme', label: 'ACGME' },
  { key: 'scfhs', label: 'SCFHS' },
  { key: 'gmc', label: 'GMC' },
  { key: 'canmeds', label: 'CanMEDS' },
  { key: 'custom', label: 'Custom' },
];

const formVariants = {
  hidden: { opacity: 0, height: 0, marginBottom: 0 },
  visible: { opacity: 1, height: 'auto', marginBottom: 16 },
  exit: { opacity: 0, height: 0, marginBottom: 0 },
};

const expandVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
};

export default function CompetencyManager({ tenantId }: CompetencyManagerProps) {
  const router = useRouter();

  const [frameworks, setFrameworks] = useState<AccreditationFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [frameworkType, setFrameworkType] = useState<FrameworkType>('acgme');
  const [milestonesJson, setMilestonesJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const fetchFrameworks = useCallback(async () => {
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from('accreditation_frameworks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setFrameworks((data as AccreditationFramework[]) || []);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchFrameworks();
  }, [fetchFrameworks]);

  function resetForm() {
    setName('');
    setVersion('1.0');
    setFrameworkType('acgme');
    setMilestonesJson('');
    setError('');
  }

  function handleToggleForm() {
    if (showForm) {
      resetForm();
    }
    setShowForm((prev) => !prev);
  }

  async function handleCreate() {
    setError('');

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    let parsedMilestones: AccreditationMilestone[];
    try {
      parsedMilestones = JSON.parse(milestonesJson);
      if (!Array.isArray(parsedMilestones)) {
        setError('Invalid JSON for milestones. Must be an array of milestone objects.');
        return;
      }
    } catch {
      setError('Invalid JSON for milestones. Must be an array of milestone objects.');
      return;
    }

    const payload = {
      name: name.trim(),
      version: version.trim() || '1.0',
      framework_type: frameworkType,
      milestones: parsedMilestones,
    };

    const result = accreditationFrameworkSchema.safeParse(payload);
    if (!result.success) {
      const messages = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      setError(messages);
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from('accreditation_frameworks').insert({
      tenant_id: tenantId,
      name: name.trim(),
      version: version.trim() || '1.0',
      framework_type: frameworkType,
      milestones: parsedMilestones,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    setShowForm(false);
    await fetchFrameworks();
  }

  async function confirmDelete(id: string) {
    setDeleteTargetId(id);
    setShowConfirmDialog(true);
  }

  async function doDelete() {
    if (!deleteTargetId) return;
    setDeleting(deleteTargetId);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('accreditation_frameworks')
      .delete()
      .eq('id', deleteTargetId);

    setDeleting(null);
    setShowConfirmDialog(false);
    setDeleteTargetId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setExpandedId(null);
    setFrameworks((prev) => prev.filter((f) => f.id !== deleteTargetId));
    router.refresh();
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      {error && <ErrorDisplay message={error} />}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-heading font-semibold">Accreditation Frameworks</h2>
        <button
          type="button"
          onClick={handleToggleForm}
          className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showForm ? 'Cancel' : 'New Framework'}
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="panel p-6 space-y-4">
              <h3 className="text-base font-semibold">Create Accreditation Framework</h3>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. ACGME General Surgery Milestones"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Version</label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Framework Type</label>
                <select
                  value={frameworkType}
                  onChange={(e) => setFrameworkType(e.target.value as FrameworkType)}
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                  aria-label="Select framework type"
                >
                  {FRAMEWORK_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <label className="text-sm font-medium text-text-secondary block mb-1">Milestones (JSON)</label>
              <textarea
                value={milestonesJson}
                onChange={(e) => setMilestonesJson(e.target.value)}
                required
                rows={8}
                className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm font-mono"
              />

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
                    saving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                  }`}
                >
                  Create Framework
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="panel p-8 text-center">
          <p className="text-text-muted">Loading frameworks...</p>
        </div>
      ) : frameworks.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-text-muted">No accreditation frameworks yet.</p>
          <p className="text-sm text-text-muted mt-1">
            Create a framework to begin mapping competencies.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {frameworks.map((framework) => {
            const isExpanded = expandedId === framework.id;
            const milestoneCount = framework.milestones?.length ?? 0;

            return (
              <div key={framework.id} className="panel p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-3 text-left"
                    onClick={() => toggleExpand(framework.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`framework-${framework.id}-details`}
                  >
                    <div>
                      <h3 className="font-semibold">{framework.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
                          {framework.framework_type.toUpperCase()}
                        </span>
                        <span className="text-xs text-text-muted">v{framework.version}</span>
                        <span className="text-xs text-text-muted">
                          {milestoneCount} milestone{milestoneCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => confirmDelete(framework.id)}
                      disabled={deleting === framework.id}
                      className="rounded-full bg-red-50 text-rejected text-sm font-medium px-3 py-1.5 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <svg
                      className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      variants={expandVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border mt-3 pt-3">
                        {framework.milestones && framework.milestones.length > 0 ? (
                          <div className="space-y-2">
                            {framework.milestones.map((m) => (
                              <div
                                key={m.code}
                                className="flex items-start gap-3 p-2.5 rounded-lg bg-neutral-dark/30"
                              >
                                <span className="inline-flex items-center bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium shrink-0">
                                  {m.code}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">{m.description}</p>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-text-muted">
                                    <span>{m.competency_area}</span>
                                    <span>&middot;</span>
                                    <span>Target: {m.target_minimum}</span>
                                    {m.specialty && (
                                      <>
                                        <span>&middot;</span>
                                        <span>{m.specialty}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-text-muted">No milestones defined.</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
      <ImpactDialog
        isOpen={showConfirmDialog}
        title="Delete Framework"
        message="This will permanently delete this accreditation framework."
        severity="danger"
        confirmLabel="Delete"
        loading={!!deleting}
        onConfirm={doDelete}
        onCancel={() => { setShowConfirmDialog(false); setDeleteTargetId(null); }}
      />
    </div>
  );
}
