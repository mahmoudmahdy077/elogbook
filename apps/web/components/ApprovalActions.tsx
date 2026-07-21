'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ErrorDisplay from '@/components/ErrorDisplay';
import { useToast } from './Toast';

interface Props {
  requestId: string;
  entryId: string;
  tenant: string;
}

export default function ApprovalActions({ requestId: _requestId, entryId, tenant }: Props) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const router = useRouter();
  const { show } = useToast();

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(action);
    setError(null);

    try {
      const res = await fetch(`/api/${tenant}/approvals/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          entry_id: entryId,
          comment: comment || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'An error occurred. Please try again.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setLoading(null);
    }
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
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add feedback (recommended for reject)..."
        rows={2}
        aria-label="Comment"
        className="w-full px-3 py-2 text-sm text-text-primary placeholder-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
      />
      {error && <ErrorDisplay message={error} />}
      {confirmReject && (
        <p className="text-xs text-warning" role="alert">
          Click Reject again to confirm. This action is irreversible.
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={onRejectClick}
          className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50 ${
            confirmReject
              ? 'bg-danger text-white hover:opacity-90'
              : 'bg-danger/10 text-danger hover:bg-danger/20'
          }`}
        >
          {loading === 'reject' ? 'Rejecting…' : confirmReject ? 'Confirm Reject' : 'Reject'}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => handleAction('approve')}
          className="inline-flex items-center px-4 py-2 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {loading === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
