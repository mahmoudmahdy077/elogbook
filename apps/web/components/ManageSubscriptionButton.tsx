'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleManage = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('create-portal-session', {
      body: { return_url: window.location.href },
    });
    if (data?.url) {
      window.location.href = data.url;
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleManage}
      disabled={loading}
      className="px-4 py-2 rounded-full border border-border text-text-primary text-sm font-medium hover:bg-surface-elevated transition-colors disabled:opacity-40"
    >
      {loading ? 'Loading...' : 'Manage subscription'}
    </button>
  );
}
