'use client';

import { useState, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DataAccessSummary {
  totalAccessEvents: number;
  byAction: { action: string; count: number }[];
  byResource: { resource_type: string; count: number }[];
  recentEvents: {
    id: string;
    created_at: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    user_id: string | null;
    ip_address: string | null;
  }[];
}

export interface PhiInventoryRow {
  table_name: string;
  total_records: number;
  phi_present: number;
  phi_redacted: number;
  phi_percentage: number;
}

export interface ConsentSummary {
  total: number;
  byType: { consent_type: string; granted: number; revoked: number }[];
  recent: {
    id: string;
    consent_type: string;
    granted_at: string;
    revoked_at: string | null;
    version: string;
  }[];
}

export interface RetentionSummary {
  softDeletedRecords: number;
  activeRecords: number;
  totalRecords: number;
  pendingCleanup: number;
  byTable: { table_name: string; deleted_count: number }[];
}

export interface ComplianceData {
  tenantSlug: string;
  dataAccess: DataAccessSummary;
  phiInventory: PhiInventoryRow[];
  consentTracking: ConsentSummary;
  retention: RetentionSummary;
}

/* ------------------------------------------------------------------ */
/*  Section card wrapper                                               */
/* ------------------------------------------------------------------ */

function SectionCard({
  title,
  description,
  children,
  onExportCsv,
  onExportPdf,
  exporting,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  exporting?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-solid border border-border p-5 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
        {(onExportCsv || onExportPdf) && (
          <div className="flex gap-1.5 shrink-0 ml-4">
            {onExportCsv && (
              <button
                type="button"
                onClick={onExportCsv}
                disabled={exporting}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-backdrop text-text-secondary border border-border hover:border-border transition-all disabled:opacity-50"
              >
                CSV
              </button>
            )}
            {onExportPdf && (
              <button
                type="button"
                onClick={onExportPdf}
                disabled={exporting}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-backdrop text-text-secondary border border-border hover:border-border transition-all disabled:opacity-50"
              >
                PDF
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini stat pill                                                     */
/* ------------------------------------------------------------------ */

function StatPill({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-backdrop px-3 py-1.5 text-sm">
      <span className="text-text-muted text-xs">{label}</span>
      <span className={`font-semibold ${color ? `text-[${color}]` : 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data Access Report                                                 */
/* ------------------------------------------------------------------ */

function DataAccessSection({ data, tenantSlug }: { data: DataAccessSummary; tenantSlug: string }) {
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExporting(true);
      try {
        const params = new URLSearchParams({ section: 'data-access', format });
        const res = await fetch(`/api/${tenantSlug}/compliance/export?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: format === 'csv' ? 'text/csv' : 'application/pdf' },
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance-data-access-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // silent
      } finally {
        setExporting(false);
      }
    },
    [tenantSlug],
  );

  return (
    <SectionCard
      title="Data Access Report"
      description="Who accessed what data and when — based on audit logs"
      onExportCsv={() => doExport('csv')}
      onExportPdf={() => doExport('pdf')}
      exporting={exporting}
    >
      {/* Summary stats */}
      <div className="flex flex-wrap gap-2 mb-4">
        <StatPill label="Total events" value={data.totalAccessEvents.toLocaleString()} color="#007AFF" />
      </div>

      {/* Actions breakdown */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {data.byAction.map((a) => (
            <div
              key={a.action}
              className="flex items-center justify-between rounded-lg bg-backdrop px-3 py-2 text-sm"
            >
              <span className="text-text-secondary truncate mr-2">{a.action}</span>
              <span className="font-semibold text-primary">{a.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Resource breakdown */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Resources</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {data.byResource.map((r) => (
            <div
              key={r.resource_type}
              className="flex items-center justify-between rounded-lg bg-backdrop px-3 py-2 text-sm"
            >
              <span className="text-text-secondary truncate mr-2">{r.resource_type}</span>
              <span className="font-semibold text-primary">{r.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent events */}
      <div>
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
          Recent events (last 20)
        </h3>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-text-muted">No recent events.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Date</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Action</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Resource</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">User</th>
                  <th className="pb-2 text-xs font-medium text-text-muted">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">{e.action}</td>
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">
                      {e.resource_type}
                      {e.resource_id && ` / ${e.resource_id.slice(-8)}`}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">
                      {e.user_id ? `…${e.user_id.slice(-8)}` : '—'}
                    </td>
                    <td className="py-1.5 text-xs text-text-secondary">{e.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/*  PHI Inventory                                                      */
/* ------------------------------------------------------------------ */

function PhiInventorySection({ data, tenantSlug }: { data: PhiInventoryRow[]; tenantSlug: string }) {
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExporting(true);
      try {
        const params = new URLSearchParams({ section: 'phi-inventory', format });
        const res = await fetch(`/api/${tenantSlug}/compliance/export?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: format === 'csv' ? 'text/csv' : 'application/pdf' },
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance-phi-inventory-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // silent
      } finally {
        setExporting(false);
      }
    },
    [tenantSlug],
  );

  return (
    <SectionCard
      title="PHI Inventory"
      description="Count of records containing Protected Health Information fields, by table"
      onExportCsv={() => doExport('csv')}
      onExportPdf={() => doExport('pdf')}
      exporting={exporting}
    >
      {data.length === 0 ? (
        <p className="text-sm text-text-muted">No tables with PHI data found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Table</th>
                <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Total records</th>
                <th className="pb-2 pr-3 text-xs font-medium text-text-muted">PHI present</th>
                <th className="pb-2 pr-3 text-xs font-medium text-text-muted">PHI redacted</th>
                <th className="pb-2 text-xs font-medium text-text-muted">% PHI</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.table_name} className="border-b border-border">
                  <td className="py-2 pr-3 text-sm font-medium text-text-primary">{row.table_name}</td>
                  <td className="py-2 pr-3 text-sm text-text-secondary">{row.total_records}</td>
                  <td className="py-2 pr-3 text-sm text-danger">{row.phi_present}</td>
                  <td className="py-2 pr-3 text-sm text-success">{row.phi_redacted}</td>
                  <td className="py-2 text-sm text-text-secondary">{row.phi_percentage.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Consent Tracking                                                   */
/* ------------------------------------------------------------------ */

function ConsentSection({ data, tenantSlug }: { data: ConsentSummary; tenantSlug: string }) {
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExporting(true);
      try {
        const params = new URLSearchParams({ section: 'consent', format });
        const res = await fetch(`/api/${tenantSlug}/compliance/export?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: format === 'csv' ? 'text/csv' : 'application/pdf' },
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance-consent-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // silent
      } finally {
        setExporting(false);
      }
    },
    [tenantSlug],
  );

  return (
    <SectionCard
      title="Consent Tracking"
      description="Patient / user consent records summary"
      onExportCsv={() => doExport('csv')}
      onExportPdf={() => doExport('pdf')}
      exporting={exporting}
    >
      {/* Summary stats */}
      <div className="flex flex-wrap gap-2 mb-4">
        <StatPill label="Total records" value={data.total} color="#007AFF" />
      </div>

      {/* By type */}
      <div className="mb-4">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
          By consent type
        </h3>
        {data.byType.length === 0 ? (
          <p className="text-sm text-text-muted">No consent records found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.byType.map((t) => (
              <div
                key={t.consent_type}
                className="flex items-center justify-between rounded-lg bg-backdrop px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-text-secondary capitalize">{t.consent_type.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-text-muted ml-2">
                    {t.granted} granted / {t.revoked} revoked
                  </span>
                </div>
                <span className="font-semibold text-primary">{t.granted + t.revoked}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent */}
      <div>
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
          Recent records (last 20)
        </h3>
        {data.recent.length === 0 ? (
          <p className="text-sm text-text-muted">No recent consent records.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Type</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Granted</th>
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Revoked</th>
                  <th className="pb-2 text-xs font-medium text-text-muted">Version</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  <tr key={c.id} className="border-b border-border">
                    <td className="py-1.5 pr-3 text-sm text-text-primary capitalize">
                      {c.consent_type.replace(/_/g, ' ')}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">
                      {new Date(c.granted_at).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-text-secondary">
                      {c.revoked_at ? new Date(c.revoked_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-1.5 text-xs text-text-secondary">{c.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Retention Status                                                   */
/* ------------------------------------------------------------------ */

function RetentionSection({ data, tenantSlug }: { data: RetentionSummary; tenantSlug: string }) {
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExporting(true);
      try {
        const params = new URLSearchParams({ section: 'retention', format });
        const res = await fetch(`/api/${tenantSlug}/compliance/export?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: format === 'csv' ? 'text/csv' : 'application/pdf' },
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance-retention-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // silent
      } finally {
        setExporting(false);
      }
    },
    [tenantSlug],
  );

  const retentionPct =
    data.totalRecords > 0 ? ((data.softDeletedRecords / data.totalRecords) * 100).toFixed(1) : '0.0';

  return (
    <SectionCard
      title="Retention Status"
      description="Soft-deleted records pending cleanup under data retention policy"
      onExportCsv={() => doExport('csv')}
      onExportPdf={() => doExport('pdf')}
      exporting={exporting}
    >
      {/* Summary stats */}
      <div className="flex flex-wrap gap-2 mb-4">
        <StatPill label="Active" value={data.activeRecords.toLocaleString()} color="#34C759" />
        <StatPill label="Soft-deleted" value={data.softDeletedRecords.toLocaleString()} color="#FF9500" />
        <StatPill label="Total" value={data.totalRecords.toLocaleString()} color="#007AFF" />
        <StatPill label="Deleted %" value={`${retentionPct}%`} color="#8E8E93" />
      </div>

      {/* By table */}
      <div>
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
          Soft-deleted records by table
        </h3>
        {data.byTable.length === 0 ? (
          <p className="text-sm text-text-muted">No soft-deleted records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-3 text-xs font-medium text-text-muted">Table</th>
                  <th className="pb-2 text-xs font-medium text-text-muted">Deleted count</th>
                </tr>
              </thead>
              <tbody>
                {data.byTable.map((row) => (
                  <tr key={row.table_name} className="border-b border-border">
                    <td className="py-2 pr-3 text-sm text-text-primary">{row.table_name}</td>
                    <td className="py-2 text-sm text-warning">{row.deleted_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ComplianceReports({ data }: { data: ComplianceData }) {
  return (
    <div>
      <DataAccessSection data={data.dataAccess} tenantSlug={data.tenantSlug} />
      <PhiInventorySection data={data.phiInventory} tenantSlug={data.tenantSlug} />
      <ConsentSection data={data.consentTracking} tenantSlug={data.tenantSlug} />
      <RetentionSection data={data.retention} tenantSlug={data.tenantSlug} />
    </div>
  );
}
