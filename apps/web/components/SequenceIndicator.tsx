'use client';

import React from 'react';
import { type ModKey } from '@/lib/shortcuts';

export default function SequenceIndicator({
  keys,
  modKey: _modKey,
}: {
  keys: string[];
  modKey: ModKey;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
      <div
        className="glass-panel px-4 py-2 flex items-center gap-3 text-sm animate-in fade-in slide-in-from-bottom-2"
        style={{ animationDuration: '200ms' }}
      >
        <span className="text-text-muted text-xs font-medium uppercase tracking-wider">
          Go to
        </span>
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span className="text-text-muted text-xs">then</span>
            )}
            <kbd
              key={i}
              className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md text-xs font-semibold tracking-tight"
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
              }}
            >
              {k.toUpperCase()}
            </kbd>
          </React.Fragment>
        ))}
        <span className="text-text-muted text-xs">…</span>
      </div>
    </div>
  );
}
