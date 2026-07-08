'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface RotationFormProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  residentId?: string;
}

export default function RotationForm({
  isOpen,
  onClose,
  tenantId,
  residentId,
}: RotationFormProps) {
  const supabase = createClient();

  const [title, setTitle] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [site, setSite] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [supervisors, setSupervisors] = useState<
    { id: string; full_name: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setSpecialty('');
      setStartDate('');
      setEndDate('');
      setSite('');
      setSupervisorId('');
      setError(null);
    }
  }, [isOpen]);

  // Load supervisors for the tenant
  useEffect(() => {
    if (!isOpen) return;
    async function loadSupervisors() {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .in('role', ['supervisor', 'director', 'institution_admin', 'admin'])
        .order('full_name', { ascending: true });
      setSupervisors((data ?? []) as { id: string; full_name: string }[]);
    }
    loadSupervisors();
  }, [isOpen, tenantId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!startDate) {
      setError('Start date is required.');
      return;
    }
    if (!endDate) {
      setError('End date is required.');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('End date must be after start date.');
      return;
    }
    if (!residentId) {
      setError('Resident is required.');
      return;
    }

    setSaving(true);

    const { error: insertError } = await supabase.from('rotations').insert({
      tenant_id: tenantId,
      resident_id: residentId,
      title: title.trim(),
      specialty: specialty.trim(),
      start_date: startDate,
      end_date: endDate,
      site: site.trim() || null,
      supervisor_id: supervisorId || null,
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg glass-panel p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-text-primary">
                New Rotation
              </h2>
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Internal Medicine — Inpatient"
                  required
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Specialty
                </label>
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="e.g. Internal Medicine"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Site
                </label>
                <input
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="e.g. University Hospital"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              {supervisors.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Supervisor
                  </label>
                  <select
                    value={supervisorId}
                    onChange={(e) => setSupervisorId(e.target.value)}
                    className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                    aria-label="Select supervisor"
                  >
                    <option value="">No supervisor</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                  {saving ? 'Saving...' : 'Create Rotation'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
