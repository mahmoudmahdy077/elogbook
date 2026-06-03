'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, Textarea } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  requestId: string;
  entryId: string;
  tenant: string;
}

export default function ApprovalActions({ requestId, entryId, tenant }: Props) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(action);

    const { error: reqError } = await supabase
      .from('approval_requests')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        comment: comment || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (reqError) {
      setLoading(null);
      return;
    }

    const { error: entryError } = await supabase
      .from('case_entries')
      .update({ status: action === 'approve' ? 'approved' : 'rejected' })
      .eq('id', entryId);

    if (entryError) {
      setLoading(null);
      return;
    }

    router.refresh();
    setLoading(null);
  };

  return (
    <div className="space-y-3">
      <Textarea
        label="Comment (optional)"
        value={comment}
        onValueChange={setComment}
        placeholder="Add feedback..."
        minRows={2}
      />
      <div className="flex gap-3">
        <Button
          color="danger"
          variant="flat"
          isLoading={loading === 'reject'}
          isDisabled={loading !== null}
          onPress={() => handleAction('reject')}
        >
          Reject
        </Button>
        <Button
          color="success"
          isLoading={loading === 'approve'}
          isDisabled={loading !== null}
          onPress={() => handleAction('approve')}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
