'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  TextField,
  TextArea,
  Select,
  ListBox,
  ListBoxItem,
  Chip,
} from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
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

  async function fetchFrameworks() {
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
  }

  useEffect(() => {
    fetchFrameworks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

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
    router.refresh();
    await fetchFrameworks();
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this accreditation framework? This action cannot be undone.')) {
      return;
    }

    setDeleting(id);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('accreditation_frameworks')
      .delete()
      .eq('id', id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(null);
      return;
    }

    setDeleting(null);
    setExpandedId(null);
    setFrameworks((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Accreditation Frameworks</h2>
        <Button color="primary" onPress={handleToggleForm}>
          {showForm ? 'Cancel' : 'New Framework'}
        </Button>
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
            <div className="glass-panel p-6 space-y-4">
              <h3 className="text-base font-semibold">Create Accreditation Framework</h3>

              <TextField
                label="Name"
                value={name}
                onChange={setName}
                isRequired
                placeholder="e.g. ACGME General Surgery Milestones"
              />

              <TextField
                label="Version"
                value={version}
                onChange={setVersion}
                placeholder="1.0"
              />

              <Select
                label="Framework Type"
                selectedKey={frameworkType}
                onSelectionChange={(val) => {
                  if (val) setFrameworkType(val as FrameworkType);
                }}
              >
                <Select.Trigger aria-label="Select framework type">
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox aria-label="Select framework type">
                    {FRAMEWORK_TYPE_OPTIONS.map((opt) => (
                      <ListBoxItem id={opt.key} key={opt.key}>
                        {opt.label}
                      </ListBoxItem>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <TextArea
                label="Milestones (JSON)"
                value={milestonesJson}
                onChange={setMilestonesJson}
                isRequired
                minRows={8}
                placeholder={`[\n  {\n    "code": "PC1",\n    "description": "Perform complete history and physical",\n    "competency_area": "Patient Care",\n    "target_minimum": 50\n  },\n  {\n    "code": "MK1",\n    "description": "Apply biomedical knowledge",\n    "competency_area": "Medical Knowledge",\n    "target_minimum": 30\n  }\n]`}
              />

              <div className="flex gap-2 justify-end">
                <Button
                  variant="light"
                  onPress={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  Cancel
                </Button>
                <Button color="primary" onPress={handleCreate} isLoading={saving}>
                  Create Framework
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-default-500">Loading frameworks...</p>
        </div>
      ) : frameworks.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-default-500">No accreditation frameworks yet.</p>
          <p className="text-sm text-default-400 mt-1">
            Create a framework to begin mapping competencies.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {frameworks.map((framework) => {
            const isExpanded = expandedId === framework.id;
            const milestoneCount = framework.milestones?.length ?? 0;

            return (
              <div key={framework.id} className="glass-panel p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-3 text-left"
                    onClick={() => toggleExpand(framework.id)}
                  >
                    <div>
                      <h3 className="font-semibold">{framework.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Chip variant="flat" size="sm" color="primary">
                          {framework.framework_type.toUpperCase()}
                        </Chip>
                        <span className="text-xs text-default-400">v{framework.version}</span>
                        <span className="text-xs text-default-400">
                          {milestoneCount} milestone{milestoneCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      onPress={() => handleDelete(framework.id)}
                      isLoading={deleting === framework.id}
                    >
                      Delete
                    </Button>
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
                                <Chip variant="flat" size="sm" color="secondary">
                                  {m.code}
                                </Chip>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">{m.description}</p>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-default-400">
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
                          <p className="text-sm text-default-400">No milestones defined.</p>
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
    </div>
  );
}
