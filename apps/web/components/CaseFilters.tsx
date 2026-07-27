'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected'] as const;

export default function CaseFilters({ basePath }: { basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const search = searchParams.get('search') || '';
  const selectedStatuses = searchParams.getAll('status');
  const sort = searchParams.get('sort') || 'date_desc';

  const buildUrl = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams();
      const finalSearch = updates.search !== undefined ? updates.search : search;
      const finalStatuses = updates.status !== undefined ? updates.status : selectedStatuses;
      const finalSort = updates.sort !== undefined ? updates.sort : sort;

      if (finalSearch) params.set('search', finalSearch);
      if (Array.isArray(finalStatuses)) {
        finalStatuses.forEach((s) => params.append('status', s));
      }
      if (finalSort && finalSort !== 'date_desc') params.set('sort', finalSort);
      params.set('page', '1');

      const qs = params.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [basePath, search, selectedStatuses, sort],
  );

  function handleSearch(value: string) {
    router.push(buildUrl({ search: value }));
  }

  function handleStatusToggle(status: string, checked: boolean) {
    const next = checked
      ? [...selectedStatuses, status]
      : selectedStatuses.filter((s) => s !== status);
    router.push(buildUrl({ status: next }));
  }

  function handleSort(value: string) {
    router.push(buildUrl({ sort: value }));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        defaultValue={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search by template name..."
        className="h-9 min-w-[200px] px-3 text-sm border border-border rounded-xl bg-surface-solid text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
      />
      <div className="flex items-center gap-1.5">
        {STATUS_OPTIONS.map((status) => {
          const checked = selectedStatuses.includes(status);
          return (
            <label
              key={status}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border cursor-pointer transition-colors ${
                checked
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-surface-solid border-border text-text-muted hover:border-border'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => handleStatusToggle(status, e.target.checked)}
                className="sr-only"
              />
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </label>
          );
        })}
      </div>
      <select
        value={sort}
        onChange={(e) => handleSort(e.target.value)}
        className="h-9 px-3 text-sm border border-border rounded-xl bg-surface-solid text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
      >
        <option value="date_desc">Date (newest)</option>
        <option value="date_asc">Date (oldest)</option>
        <option value="status_asc">Status (A-Z)</option>
        <option value="status_desc">Status (Z-A)</option>
      </select>
    </div>
  );
}
