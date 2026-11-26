'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();

  const handleManage = async () => {
    setLoading(true);
    setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('create-portal-session', {
      body: { return_url: window.location.href },
    });
    if (invokeError) {
      setError('Billing portal is unavailable. Contact your administrator.');
      setLoading(false);
      return;
    }
    if (!data?.url) {
      setError('No billing portal is configured for this account.');
      setLoading(false);
      return;
    }
    window.location.href = data.url;
  };

  return (
    <div>
      <button
        onClick={handleManage}
        disabled={loading}
        className="px-4 py-2 rounded-full border border-border text-text-primary text-sm font-medium hover:bg-surface-raised transition-colors disabled:opacity-40"
      >
        {loading ? 'Opening…' : 'Manage subscription'}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-fg-danger">{error}</p> : null}
    </div>
  );
}
