'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { STAGGER_DELAY } from '@elogbook/shared';

type Status = 'draft' | 'pending' | 'approved' | 'rejected';

interface DonutData {
  status: Status;
  count: number;
  color: string;
}

interface BarData {
  specialty: string;
  count: number;
}

const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<Status, string> = {
  approved: '#34C759',
  pending: '#FF9500',
  draft: '#8E8E93',
  rejected: '#FF3B30',
};

function DonutChart({ data, total }: { data: DonutData[]; total: number }) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const reduceMotion = useReducedMotion();
  let accumulated = 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90" role="img" aria-label="Resident completion rates by status">
        <title>Resident completion rates by status</title>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="rgba(60, 60, 67, 0.10)" strokeWidth="16" />
        {data.map((segment, index) => {
          const pct = total > 0 ? segment.count / total : 0;
          const dashOffsetStart = circumference * (1 - accumulated);
          accumulated += pct;
          return (
            <motion.circle
              key={segment.status}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffsetStart }}
              transition={reduceMotion ? { duration: 0 } : {
                duration: 0.8,
                delay: index * STAGGER_DELAY + 0.2,
                ease: 'easeOut',
              }}
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-3">
        {data.map((segment) => (
          <div key={segment.status} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-[#8E8E93]">{STATUS_LABELS[segment.status]}</span>
            <span className="font-semibold text-black">{segment.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ data, max }: { data: BarData[]; max: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <p className="text-sm text-[#8E8E93]">No cases logged yet.</p>
      ) : (
        data.map((item, index) => {
          const pct = max > 0 ? (item.count / max) * 100 : 0;
          const isHovered = hovered === item.specialty;
          return (
            <motion.div
              key={item.specialty}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: index * STAGGER_DELAY + 0.2 }}
              className="relative"
              onMouseEnter={() => setHovered(item.specialty)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[#3C3C43] font-medium truncate pr-2">{item.specialty}</span>
                <span className="text-[#8E8E93] clinical-data">{item.count}</span>
              </div>
              <div className="h-1 rounded-full bg-black/5 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: index * STAGGER_DELAY + 0.3, ease: 'easeOut' }}
                />
              </div>
              {isHovered && (
                <div className="absolute -top-8 right-0 px-2 py-1 rounded-lg bg-white border border-black/5 text-xs text-[#3C3C43] z-10 shadow-sm">
                  {item.specialty}: {item.count}
                </div>
              )}
            </motion.div>
          );
        })
      )}
    </div>
  );
}

interface ProgramOverviewChartsProps {
  statusCounts: Record<Status, number>;
  specialtyCounts: Record<string, number>;
}

export default function ProgramOverviewCharts({ statusCounts, specialtyCounts }: ProgramOverviewChartsProps) {
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const donutData: DonutData[] = [
    { status: 'approved', count: statusCounts.approved, color: STATUS_COLORS.approved },
    { status: 'pending', count: statusCounts.pending, color: STATUS_COLORS.pending },
    { status: 'draft', count: statusCounts.draft, color: STATUS_COLORS.draft },
    { status: 'rejected', count: statusCounts.rejected, color: STATUS_COLORS.rejected },
  ];

  const barData = Object.entries(specialtyCounts)
    .map(([specialty, count]) => ({ specialty, count }))
    .sort((a, b) => b.count - a.count);
  const maxSpecialty = Math.max(1, ...barData.map((d) => d.count));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="bg-white rounded-2xl border border-black/5 p-5">
        <h2 className="text-lg font-semibold text-black tracking-[-0.02em] font-sans mb-4">Completion Rates by Status</h2>
        <DonutChart data={donutData} total={total || 1} />
      </div>

      <div className="bg-white rounded-2xl border border-black/5 p-5">
        <h2 className="text-lg font-semibold text-black tracking-[-0.02em] font-sans mb-4">Specialty Distribution</h2>
        <BarChart data={barData} max={maxSpecialty} />
      </div>
    </div>
  );
}
