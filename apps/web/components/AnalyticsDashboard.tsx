'use client';

/* ===================================================================
 * Types
 * =================================================================== */

interface MonthlyVolume {
  month: string;
  count: number;
}

interface SpecialtyCount {
  specialty: string;
  count: number;
}

interface SupervisorRow {
  supervisorId: string;
  supervisorName: string;
  pending: number;
  approved: number;
  rejected: number;
}

interface MonthlyRate {
  month: string;
  rate: number;
}

interface AnalyticsData {
  monthlyVolume: MonthlyVolume[];
  specialtyBreakdown: SpecialtyCount[];
  supervisorWorkload: SupervisorRow[];
  monthlyApprovalRate: MonthlyRate[];
}

/* ===================================================================
 * Color palette — Apple Health / system colours
 * =================================================================== */

const CHART_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE',
  '#5856D6', '#FF6482', '#00C7BE', '#32D74B', '#FFD60A',
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9500',
  approved: '#34C759',
  rejected: '#FF3B30',
};

/* ===================================================================
 * Helpers
 * =================================================================== */

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function shortMonthLabel(ym: string): string {
  const [, m] = ym.split('-');
  const date = new Date(2000, Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'short' });
}

/* ===================================================================
 * 1. Bar Chart — monthly case volume
 * =================================================================== */

function CaseVolumeChart({ data }: { data: MonthlyVolume[] }) {
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const barWidth = Math.max(12, Math.min(40, 360 / data.length - 8));
  const chartHeight = 180;
  const labelHeight = 20;

  return (
    <div>
      <svg
        width="100%"
        height={chartHeight + labelHeight + 8}
        viewBox={`0 0 ${data.length * (barWidth + 8) + 40} ${chartHeight + labelHeight + 8}`}
        role="img"
        aria-label="Case volume by month"
        className="w-full"
      >
        <title>Case volume by month</title>

        {/* Y-axis reference lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = chartHeight - frac * chartHeight;
          return (
            <g key={frac}>
              <line
                x1={30}
                y1={y}
                x2={data.length * (barWidth + 8) + 30}
                y2={y}
                stroke="rgba(60,60,67,0.06)"
                strokeWidth={1}
              />
              <text
                x={26}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="#8E8E93"
              >
                {Math.round(frac * maxCount)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = maxCount > 0 ? (d.count / maxCount) * chartHeight : 0;
          const x = 30 + i * (barWidth + 8);
          const y = chartHeight - barH;
          return (
            <g key={d.month}>
              <title>{`${formatMonthLabel(d.month)}: ${d.count} cases`}</title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barH, 2)}
                rx={3}
                ry={3}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                opacity={0.85}
              />
              {/* Month label */}
              {i % 2 === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#8E8E93"
                >
                  {shortMonthLabel(d.month)}
                </text>
              )}
              {/* Value on hover — show inline */}
              {d.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#3C3C43"
                  fontWeight={600}
                  style={{ display: 'none' }}
                  className="chart-value-label"
                >
                  {d.count}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Footnotes / totals */}
      <div className="flex items-center gap-4 mt-2 text-xs text-[#8E8E93]">
        <span>
          Total:{' '}
          <strong className="text-[#3C3C43]">
            {data.reduce((s, d) => s + d.count, 0)}
          </strong>
        </span>
        <span>
          Avg:{' '}
          <strong className="text-[#3C3C43]">
            {Math.round(
              data.reduce((s, d) => s + d.count, 0) / Math.max(data.length, 1)
            )}
          </strong>{' '}
          / month
        </span>
      </div>
    </div>
  );
}

/* ===================================================================
 * 2. Horizontal Bar Chart — specialty breakdown
 * =================================================================== */

function SpecialtyChart({ data }: { data: SpecialtyCount[] }) {
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const barHeight = 20;
  const gap = 10;
  const labelWidth = 120;
  const chartWidth = 400;

  if (data.length === 0) {
    return (
      <p className="text-sm text-[#8E8E93] py-6 text-center">
        No cases with specialty data.
      </p>
    );
  }

  return (
    <svg
      width="100%"
      height={data.length * (barHeight + gap) + 12}
      viewBox={`0 0 ${chartWidth} ${data.length * (barHeight + gap) + 12}`}
      role="img"
      aria-label="Cases by specialty"
      className="w-full"
    >
      <title>Cases by specialty</title>
      {data.map((d, i) => {
        const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
        const barW = (pct / 100) * (chartWidth - labelWidth - 50);
        const y = 8 + i * (barHeight + gap);
        const color = CHART_COLORS[i % CHART_COLORS.length];

        return (
          <g key={d.specialty}>
            <title>{`${d.specialty}: ${d.count} cases`}</title>
            {/* Label */}
            <text
              x={0}
              y={y + barHeight / 2 + 1}
              fontSize={11}
              fill="#3C3C43"
              fontWeight={500}
              textAnchor="start"
            >
              {d.specialty}
            </text>
            {/* Bar */}
            <rect
              x={labelWidth + 4}
              y={y + 2}
              width={Math.max(barW, 4)}
              height={barHeight - 4}
              rx={4}
              ry={4}
              fill={color}
              opacity={0.85}
            />
            {/* Count */}
            <text
              x={labelWidth + 8 + Math.max(barW, 4) + 4}
              y={y + barHeight / 2 + 1}
              fontSize={11}
              fill="#8E8E93"
              fontWeight={600}
            >
              {d.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ===================================================================
 * 3. Supervisor Workload Table
 * =================================================================== */

function SupervisorTable({ data }: { data: SupervisorRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#8E8E93] py-6 text-center">
        No supervisor review data yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/5">
            <th className="text-left py-2 pr-3 font-medium text-[#8E8E93] text-xs uppercase tracking-wider">
              Supervisor
            </th>
            <th className="text-right py-2 px-2 font-medium text-[#8E8E93] text-xs uppercase tracking-wider">
              <span style={{ color: STATUS_COLORS.pending }}>Pending</span>
            </th>
            <th className="text-right py-2 px-2 font-medium text-[#8E8E93] text-xs uppercase tracking-wider">
              <span style={{ color: STATUS_COLORS.approved }}>Approved</span>
            </th>
            <th className="text-right py-2 px-2 font-medium text-[#8E8E93] text-xs uppercase tracking-wider">
              <span style={{ color: STATUS_COLORS.rejected }}>Rejected</span>
            </th>
            <th className="text-right py-2 pl-2 font-medium text-[#8E8E93] text-xs uppercase tracking-wider">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => {
            const total = s.pending + s.approved + s.rejected;
            return (
              <tr
                key={s.supervisorId}
                className="border-b border-black/5 hover:bg-black/[0.02] transition-colors"
              >
                <td className="py-2.5 pr-3 font-medium text-[#3C3C43] truncate max-w-[140px]">
                  {s.supervisorName}
                </td>
                <td className="py-2.5 px-2 text-right font-semibold tabular-nums">
                  <span style={{ color: STATUS_COLORS.pending }}>
                    {s.pending}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-right font-semibold tabular-nums">
                  <span style={{ color: STATUS_COLORS.approved }}>
                    {s.approved}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-right font-semibold tabular-nums">
                  <span style={{ color: STATUS_COLORS.rejected }}>
                    {s.rejected}
                  </span>
                </td>
                <td className="py-2.5 pl-2 text-right font-semibold tabular-nums text-[#3C3C43]">
                  {total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===================================================================
 * 4. Trend Sparkline — monthly approval rate
 * =================================================================== */

function ApprovalSparkline({ data }: { data: MonthlyRate[] }) {
  const width = 320;
  const height = 48;
  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const maxRate = Math.max(0.01, ...data.map((d) => d.rate));

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-12 text-xs text-[#8E8E93]">
        <p>Insufficient data for trend</p>
      </div>
    );
  }

  const points = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * innerW;
    const y = padding + innerH - (d.rate / maxRate) * innerH;
    return `${x},${y}`;
  });
  const linePath = points.join(' ');

  // Simple area fill under the line
  const areaPath =
    `M${padding},${padding + innerH} ` +
    points.map((p) => `L${p}`).join(' ') +
    ` L${padding + innerW},${padding + innerH} Z`;

  const avgRate =
    data.reduce((s, d) => s + d.rate, 0) / Math.max(data.length, 1);
  const displayRate = `${(avgRate * 100).toFixed(0)}%`;

  return (
    <div className="flex items-end gap-4">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Monthly approval rate trend, average ${displayRate}`}
        className="shrink-0"
      >
        <title>Monthly approval rate: {displayRate} average</title>
        {/* Area fill */}
        <path d={areaPath} fill="#34C759" opacity={0.12} />
        {/* Line */}
        <polyline
          points={linePath}
          fill="none"
          stroke="#34C759"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dots */}
        {data.map((d, i) => {
          const x = padding + (i / Math.max(data.length - 1, 1)) * innerW;
          const y = padding + innerH - (d.rate / maxRate) * innerH;
          return (
            <circle
              key={d.month}
              cx={x}
              cy={y}
              r={2.5}
              fill="#34C759"
              opacity={0.8}
            >
              <title>{`${formatMonthLabel(d.month)}: ${(d.rate * 100).toFixed(0)}%`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="text-xs text-[#8E8E93] whitespace-nowrap">
        <span className="text-[#34C759] font-semibold text-sm">
          {displayRate}
        </span>
        <br />
        avg approval rate
      </div>
    </div>
  );
}

/* ===================================================================
 * 5. Mini KPI row for summary stats
 * =================================================================== */

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
    <div className="bg-white rounded-2xl border border-black/5 p-4 flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold text-[#8E8E93] uppercase tracking-wider">
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

/* ===================================================================
 * Main component
 * =================================================================== */

export default function AnalyticsDashboard({
  data,
}: {
  data: AnalyticsData;
}) {
  const { monthlyVolume, specialtyBreakdown, supervisorWorkload, monthlyApprovalRate } = data;

  const totalCases = monthlyVolume.reduce((s, d) => s + d.count, 0);
  const avgMonthly = Math.round(totalCases / Math.max(monthlyVolume.length, 1));
  const specialties = specialtyBreakdown.length;
  const supervisors = supervisorWorkload.length;

  return (
    <div className="space-y-7">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div>
        <h1 className="text-[2rem] font-semibold text-[#000] tracking-[-0.03em] font-sans">
          Analytics
        </h1>
        <p className="text-[0.9rem] text-[#8E8E93] mt-1 font-normal">
          Case volume trends, specialty distribution &amp; supervisor workload
        </p>
      </div>

      {/* ── Mini KPI row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat
          label="Total Cases (12mo)"
          value={totalCases.toLocaleString()}
          color="#007AFF"
        />
        <MiniStat
          label="Monthly Avg"
          value={avgMonthly.toLocaleString()}
          color="#34C759"
        />
        <MiniStat
          label="Specialties"
          value={specialties.toLocaleString()}
          color="#AF52DE"
        />
        <MiniStat
          label="Supervisors"
          value={supervisors.toLocaleString()}
          color="#FF9500"
        />
      </div>

      {/* ── Row 1: Case Volume + Sparkline ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-black/5 p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-[#000] tracking-[-0.02em] font-sans mb-4">
            Case Volume
          </h2>
          <CaseVolumeChart data={monthlyVolume} />
        </div>
        <div className="bg-white rounded-2xl border border-black/5 p-5">
          <h2 className="text-lg font-semibold text-[#000] tracking-[-0.02em] font-sans mb-3">
            Approval Rate
          </h2>
          <ApprovalSparkline data={monthlyApprovalRate} />
          {/* Mini legend */}
          <div className="mt-4 space-y-1.5 text-xs text-[#8E8E93]">
            {monthlyApprovalRate.filter((d) => d.rate > 0).slice(-3).map((d) => (
              <div
                key={d.month}
                className="flex items-center justify-between"
              >
                <span>{formatMonthLabel(d.month)}</span>
                <span className="font-semibold text-[#3C3C43]">
                  {(d.rate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {monthlyApprovalRate.filter((d) => d.rate > 0).length > 3 && (
              <p className="pt-1 text-[10px] text-[#8E8E93]">
                +{monthlyApprovalRate.filter((d) => d.rate > 0).length - 3} more months
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Specialty + Supervisor Table ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-black/5 p-5">
          <h2 className="text-lg font-semibold text-[#000] tracking-[-0.02em] font-sans mb-4">
            Specialty Distribution
          </h2>
          <SpecialtyChart data={specialtyBreakdown} />
        </div>
        <div className="bg-white rounded-2xl border border-black/5 p-5">
          <h2 className="text-lg font-semibold text-[#000] tracking-[-0.02em] font-sans mb-4">
            Supervisor Workload
          </h2>
          <SupervisorTable data={supervisorWorkload} />
        </div>
      </div>
    </div>
  );
}
