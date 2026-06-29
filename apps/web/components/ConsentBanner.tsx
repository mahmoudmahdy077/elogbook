'use client';

import { useState } from 'react';
import { grantConsent, denyConsent, hasConsent } from '@/lib/analytics';

export default function ConsentBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => hasConsent() || (typeof document !== 'undefined' && document.cookie.includes('analytics_consent')));
  if (dismissed) return null;

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed bottom-4 inset-x-4 md:inset-x-auto md:right-4 md:max-w-md panel p-4 z-50 shadow-2xl"
    >
      <h2 className="text-sm font-medium mb-1">Help us improve E-Logbook</h2>
      <p className="text-xs text-neutral-light/60 mb-3">
        We use privacy-respecting analytics (no PHI) to understand which features are most useful.
        You can change this anytime in your profile.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => { grantConsent(); setDismissed(true); }}
          className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
        >
          Allow analytics
        </button>
        <button
          onClick={() => { denyConsent(); setDismissed(true); }}
          className="flex-1 py-2 rounded-lg border border-border text-sm text-neutral-light/80 hover:bg-neutral-dark/50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
