'use client';

import { createClient } from '@/lib/supabase/client';
import { Button, TextArea } from '@heroui/react';
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(null);
      return;
    }

    const rpcName = action === 'approve' ? 'approve_case' : 'reject_case';
    const { error } = await supabase.rpc(rpcName, {
      p_entry_id: entryId,
      p_supervisor_id: user.id,
      p_comment: comment || null,
    });

    if (error) {
      setLoading(null);
      return;
    }

    router.refresh();
    setLoading(null);
  };

  return (
    <div className="space-y-3">
      <TextArea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add feedback..."
        rows={2}
      />
      <div className="flex gap-3">
        <Button
          variant="danger-soft"
          isDisabled={loading !== null}
          onPress={() => handleAction('reject')}
        >
          Reject
        </Button>
        <Button
          variant="primary"
          isDisabled={loading !== null}
          onPress={() => handleAction('approve')}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
