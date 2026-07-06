'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { programGoalSchema } from '@elogbook/shared';
import ErrorDisplay from '@/components/ErrorDisplay';
import { createClient } from '@/lib/supabase/client';

interface GoalFormProps {
  tenantId: string;
  directorId: string;
  residents: { id: string; full_name: string }[];
}

export default function GoalForm({ tenantId, directorId, residents }: GoalFormProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const [residentId, setResidentId] = useState('');
  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setResidentId('');
    setTitle('');
    setTargetCount('');
    setSpecialty('');
    setDeadline('');
    setDescription('');
    setError('');
  }

  async function handleSubmit() {
    setError('');

    const result = programGoalSchema.safeParse({
      resident_id: residentId,
      title,
      target_count: Number(targetCount),
      specialty: specialty || null,
      deadline,
      description: description || null,
    });

    if (!result.success) {
      setError(result.error.issues.map((e) => e.message).join(', '));
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data: goal, error: insertError } = await supabase
      .from('program_goals')
      .insert({
        tenant_id: tenantId,
        director_id: directorId,
        resident_id: result.data.resident_id,
        title: result.data.title,
        target_count: result.data.target_count,
        specialty: result.data.specialty ?? null,
        deadline: result.data.deadline,
        description: result.data.description ?? null,
      })
      .select('id')
      .single();

    if (insertError || !goal) {
      setError(insertError?.message ?? 'Failed to create goal');
      setLoading(false);
      return;
    }

    const { error: progressError } = await supabase
      .from('goal_progress')
      .insert({
        goal_id: goal.id,
        resident_id: result.data.resident_id,
        current_count: 0,
      });

    if (progressError) {
      setError(progressError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    resetForm();
    router.refresh();
    setShowModal(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        New Goal
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
          <div className="panel p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold mb-4">Create Goal</h3>

            {error && <ErrorDisplay message={error} />}

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Resident</label>
                <select
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  required
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                  aria-label="Select resident"
                >
                  <option value="">Select a resident...</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>{r.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. Complete 50 appendectomies"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Target Count</label>
                <input
                  type="number"
                  value={targetCount}
                  onChange={(e) => setTargetCount(e.target.value)}
                  required
                  placeholder="50"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Specialty</label>
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="e.g. General Surgery"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  required
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setShowModal(false); resetForm(); }}
                className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
                  loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
