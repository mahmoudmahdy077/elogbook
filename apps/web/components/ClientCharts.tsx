'use client';

import dynamic from 'next/dynamic';

const ProgramOverviewCharts = dynamic(
  () => import('@/components/ProgramOverviewCharts'),
  { ssr: false }
);

interface ClientChartsProps {
  statusCounts: Record<string, number>;
  specialtyCounts: Record<string, number>;
}

export default function ClientCharts({ statusCounts, specialtyCounts }: ClientChartsProps) {
  return <ProgramOverviewCharts statusCounts={statusCounts as any} specialtyCounts={specialtyCounts as any} />;
}
