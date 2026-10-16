'use client';

/* ===================================================================
 * BenchmarkingDashboard — multi-institution (de-identified) peer
 * comparison for program directors. Apple Health light aesthetic:
 * flat surfaces, zero shadows, #007AFF accent.
 * =================================================================== */

export interface BenchmarkRow {
  specialty: string;
  procedureType: string;
  ownCases: number;
  ownResidents: number;
  ownAvgPerResident: number | null;
  peerAvgPerResident: number | null;
  peerTenantCount: number;
  peerTotalResidents: number;
  percentile: number | null;
}

interface BenchmarkingData {
  rows: BenchmarkRow[];
}

/* Pure helpers (unit-tested) ----------------------------------------- */

export function summarizeBenchmarks(rows: BenchmarkRow[]): {
  trackedProcedures: number;
  peerTenantCount: number;
  meanPercentile: number | null;
} {
  const trackedProcedures = rows.length;
  const peerTenantCount = rows.reduce(
    (max, r) => Math.max(max, r.peerTenantCount),
    0
  );
  const percentiles = rows
    .map((r) => r.percentile)
    .filter((p): p is number => p !== null);
  const meanPercentile =
    percentiles.length > 0
      ? Math.round(
          percentiles.reduce((s, p) => s + p, 0) / percentiles.length
        )
      : null;
  return { trackedProcedures, peerTenantCount, meanPercentile };
}

/** "Top 15%" framing for a percentile rank (100 = highest volume). */
export function percentileLabel(percentile: number | null): string {
  if (percentile === null) return 'No peer data';
  return `Top ${Math.max(1, Math.ceil(100 - percentile))}%`;
}

export function formatAvg(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(1);
}

/* Bars ---------------------------------------------------------------- */

function ComparisonBar({
  ownAvg,
  peerAvg,
}: {
  ownAvg: number | null;
  peerAvg: number | null;
}) {
  const max = Math.max(ownAvg ?? 0, peerAvg ?? 0, 1);
  const ownPct = ((ownAvg ?? 0) / max) * 100;
  const peerPct = ((peerAvg ?? 0) / max) * 100;

  return (
    <div className="space-y-1.5" aria-hidden="true">
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-black/5">
          <div
            className="h-2 rounded-full"
            style={{ width: `${ownPct}%`, backgroundColor: '#007AFF' }}
          />
        </div>
        <span className="w-10 text-right text-xs font-semibold tabular-nums text-text-secondary">
          {formatAvg(ownAvg)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-black/5">
          <div
            className="h-2 rounded-full"
            style={{ width: `${peerPct}%`, backgroundColor: '#8E8E93' }}
          />
        </div>
        <span className="w-10 text-right text-xs font-semibold tabular-nums text-text-secondary">
          {formatAvg(peerAvg)}
        </span>
      </div>
    </div>
  );
}

function BenchmarkCard({ row }: { row: BenchmarkRow }) {
  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-text-primary tracking-[-0.02em] font-sans">
            {row.specialty}
          </p>
          <p className="text-xs text-text-muted">{row.procedureType}</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold text-text-muted uppercase tracking-wider bg-black/5">
          {percentileLabel(row.percentile)}
        </span>
      </div>
      <ComparisonBar ownAvg={row.ownAvgPerResident} peerAvg={row.peerAvgPerResident} />
      <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
        <span>
          {row.ownCases.toLocaleString()} cases ·{' '}
          {row.ownResidents.toLocaleString()} residents
        </span>
        <span>
          {row.peerTenantCount} peer institution
          {row.peerTenantCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

/* MiniStat — same flat card pattern as AnalyticsDashboard ------------- */

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-4 flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <span
        className="text-2xl font-semibold tracking-[-0.02em]"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

/* Main ---------------------------------------------------------------- */

export default function BenchmarkingDashboard({ data }: { data: BenchmarkingData }) {
  const rows = data.rows ?? [];
  const { trackedProcedures, peerTenantCount, meanPercentile } =
    summarizeBenchmarks(rows);

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans">
          Peer Benchmarking
        </h1>
        <p className="text-[0.9rem] text-text-muted mt-1 font-normal">
          De-identified case-volume comparison against peer institutions
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Tracked Procedures" value={trackedProcedures.toLocaleString()} color="#007AFF" />
        <MiniStat label="Peer Institutions" value={peerTenantCount.toLocaleString()} color="#AF52DE" />
        <MiniStat
          label="Mean Percentile"
          value={meanPercentile === null ? '—' : `${meanPercentile}`}
          color="#186B2E"
        />
        <MiniStat
          label="Data Basis"
          value="Approved"
          color="#8F4200"
        />
      </div>

      {/* De-identification notice */}
      <p className="text-xs text-text-muted px-1">
        Peer values are aggregate averages only — no other institution&apos;s
        identities, case details, or resident counts below institution level are
        accessible.
      </p>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="bg-surface-solid rounded-2xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">
            No benchmark data yet — appear here once your institution has approved cases.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {rows.map((row) => (
            <BenchmarkCard
              key={`${row.specialty}-${row.procedureType}`}
              row={row}
            />
          ))}
        </div>
      )}
    </div>
  );
}
