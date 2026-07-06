'use client';

import dynamic from 'next/dynamic';

const CaseForm = dynamic(() => import('@/components/CaseForm'), {
  ssr: false,
  loading: () => (
    <div className="glass-panel p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-1/3" />
        <div className="h-10 bg-black/10 dark:bg-white/10 rounded-xl" />
        <div className="h-10 bg-black/10 dark:bg-white/10 rounded-xl" />
        <div className="h-20 bg-black/10 dark:bg-white/10 rounded-xl" />
      </div>
    </div>
  ),
});

interface ClientCaseFormProps {
  tenantId: string;
  tenantSlug: string;
  initialStatus: string;
  duplicateCaseId?: string;
  lastEntry?: boolean;
}

export default function ClientCaseForm({ tenantId, tenantSlug, initialStatus, duplicateCaseId, lastEntry }: ClientCaseFormProps) {
  return (
    <CaseForm
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      initialStatus={initialStatus}
      duplicateCaseId={duplicateCaseId}
      lastEntry={lastEntry}
    />
  );
}
