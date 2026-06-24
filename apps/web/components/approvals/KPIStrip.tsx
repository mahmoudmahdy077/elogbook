'use client';

import { clinicalTokens } from '@elogbook/shared';
import { Panel } from '@elogbook/shared';
import { SimpleCounter } from './SimpleCounter';

interface KPIStripProps {
  pendingCount: number;
  todayCount: number;
  thisWeekCount: number;
  approvalRate: number;
}

const kpiItems = [
  { label: 'Pending', color: clinicalTokens.colors.warning.DEFAULT, value: 0 },
  { label: 'Today', color: clinicalTokens.colors.secondary.DEFAULT, value: 0 },
  { label: 'This Week', color: clinicalTokens.colors.primary.DEFAULT, value: 0 },
  { label: 'Approval Rate', color: clinicalTokens.colors.success.DEFAULT, value: 0, suffix: '%' },
];

export function KPIStrip({ pendingCount, todayCount, thisWeekCount, approvalRate }: KPIStripProps) {
  const items = [
    { label: 'Pending', color: clinicalTokens.colors.warning.DEFAULT, value: pendingCount },
    { label: 'Today', color: clinicalTokens.colors.secondary.DEFAULT, value: todayCount },
    { label: 'This Week', color: clinicalTokens.colors.primary.DEFAULT, value: thisWeekCount },
    { label: 'Approval Rate', color: clinicalTokens.colors.success.DEFAULT, value: approvalRate, suffix: '%' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ label, color, value, suffix }, index) => (
        <Panel key={label} className="p-4 text-center">
          <p className="text-2xl font-bold font-heading" style={{ color, fontFamily: clinicalTokens.fonts.heading }}>
            <SimpleCounter value={value} />
            {suffix && <span className="text-lg" style={{ color }}>{suffix}</span>}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">{label}</p>
        </Panel>
      ))}
    </div>
  );
}