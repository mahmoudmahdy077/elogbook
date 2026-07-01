'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, TextArea } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ErrorDisplay from '@/components/ErrorDisplay';
import { useToast } from './Toast';

interface Props {
  requestId: string;
  entryId: string;
  tenant: string;
}

export default function ApprovalActions({ requestId, entryId, tenant }: Props) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const { show } = useToast();

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(action);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('You must be logged in to perform this action.');
      setLoading(null);
      return;
    }

    const rpcName = action === 'approve' ? 'approve_case' : 'reject_case';
    const { error: rpcError } = await supabase.rpc(rpcName, {
      p_entry_id: entryId,
      p_supervisor_id: user.id,
      p_comment: comment || null,
    });

    if (rpcError) {
      setError(rpcError.message || 'An error occurred. Please try again.');
      setLoading(null);
      return;
    }

    show(
      action === 'approve' ? 'Case approved successfully' : 'Case rejected',
      action === 'approve' ? 'success' : 'error',
    );
    router.refresh();
    setLoading(null);
    setComment('');
    setConfirmReject(false);
  };

  const onRejectClick = () => {
    // U5.1: irreversible medical-training record — confirm first.
    if (!confirmReject) {
      setConfirmReject(true);
      setError(null);
      return;
    }
    handleAction('reject');
  };

  return (
    <div className="space-y-3">
      <TextArea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add feedback (recommended for reject)..."
        rows={2}
        aria-label="Comment"
      />
      {error && <ErrorDisplay message={error} />}
      {confirmReject && (
        <p className="text-xs text-pending" role="alert">
          Click Reject again to confirm. This action is irreversible.
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant={confirmReject ? 'danger' : 'danger-soft'}
          isDisabled={loading !== null}
          onPress={onRejectClick}
        >
          {loading === 'reject' ? 'Rejecting…' : confirmReject ? 'Confirm Reject' : 'Reject'}
        </Button>
        <Button
          variant="primary"
          isDisabled={loading !== null}
          onPress={() => handleAction('approve')}
        >
          {loading === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </div>
  );
}
