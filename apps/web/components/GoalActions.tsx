'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GoalForm from '@/components/GoalForm';
import ImpactDialog from '@/components/ImpactDialog';
import ErrorDisplay from '@/components/ErrorDisplay';
import { createClient } from '@/lib/supabase/client';

interface GoalData {
  id: string;
  resident_id: string;
  title: string;
  target_count: number;
  specialty: string | null;
  deadline: string;
  description: string | null;
}

interface GoalActionsProps {
  goal: GoalData;
  tenantId: string;
  directorId: string;
  residents: { id: string; full_name: string }[];
}

export default function GoalActions({ goal, tenantId, directorId, residents }: GoalActionsProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    setDeleting(true);
    setError('');
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from('program_goals')
      .delete()
      .eq('id', goal.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setShowDeleteDialog(false);
    router.refresh();
  }

  return (
    <>
      {error && <ErrorDisplay message={error} />}
      <div className="flex items-center gap-2">
        <GoalForm
          tenantId={tenantId}
          directorId={directorId}
          residents={residents}
          initialGoal={goal}
        />
        <button
          type="button"
          onClick={() => setShowDeleteDialog(true)}
          className="rounded-full bg-red-50 text-rejected text-sm font-medium px-3 py-1.5 hover:bg-red-100 transition-colors"
        >
          Delete
        </button>
      </div>

      <ImpactDialog
        isOpen={showDeleteDialog}
        title="Delete Goal"
        message={`Delete "${goal.title}"? This will permanently remove the goal and its progress data.`}
        severity="danger"
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  );
}
