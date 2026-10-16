import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchmarkingDashboard, {
  summarizeBenchmarks,
  percentileLabel,
  formatAvg,
  type BenchmarkRow,
} from '../BenchmarkingDashboard';

function row(overrides: Partial<BenchmarkRow> = {}): BenchmarkRow {
  return {
    specialty: 'Orthopaedics',
    procedureType: 'Total hip arthroplasty',
    ownCases: 42,
    ownResidents: 6,
    ownAvgPerResident: 7.0,
    peerAvgPerResident: 5.2,
    peerTenantCount: 4,
    peerTotalResidents: 21,
    percentile: 90,
    ...overrides,
  };
}

describe('benchmark helpers', () => {
  it('summarizes tracked procedures, peer count, and mean percentile', () => {
    const s = summarizeBenchmarks([row(), row({ percentile: 70 })]);
    expect(s.trackedProcedures).toBe(2);
    expect(s.peerTenantCount).toBe(4);
    expect(s.meanPercentile).toBe(80);
  });

  it('returns null mean percentile with no data', () => {
    expect(summarizeBenchmarks([]).meanPercentile).toBeNull();
    expect(summarizeBenchmarks([]).trackedProcedures).toBe(0);
    expect(summarizeBenchmarks([]).peerTenantCount).toBe(0);
  });

  it('formats averages and percentile labels', () => {
    expect(formatAvg(7.06)).toBe('7.1');
    expect(formatAvg(null)).toBe('—');
    expect(percentileLabel(90)).toBe('Top 10%');
    expect(percentileLabel(100)).toBe('Top 1%');
    expect(percentileLabel(null)).toBe('No peer data');
  });

  it('ignores null percentiles when averaging', () => {
    const s = summarizeBenchmarks([row({ percentile: 80 }), row({ percentile: null })]);
    expect(s.meanPercentile).toBe(80);
    expect(s.trackedProcedures).toBe(2);
  });
});

describe('BenchmarkingDashboard render', () => {
  it('renders specialty rows, KPIs, and de-identification notice', () => {
    const html = renderToStaticMarkup(
      <BenchmarkingDashboard data={{ rows: [row()] }} />
    );
    expect(html).toContain('Peer Benchmarking');
    expect(html).toContain('Orthopaedics');
    expect(html).toContain('Total hip arthroplasty');
    expect(html).toContain('Top 10%');
    expect(html).toContain('De-identified');
  });

  it('renders empty state without crashing', () => {
    const html = renderToStaticMarkup(<BenchmarkingDashboard data={{ rows: [] }} />);
    expect(html).toContain('No benchmark data yet');
    expect(html).toContain('De-identified');
  });

  it('renders null averages as em dashes, never NaN', () => {
    const html = renderToStaticMarkup(
      <BenchmarkingDashboard
        data={{ rows: [row({ ownAvgPerResident: null, peerAvgPerResident: null, percentile: null })] }}
      />
    );
    expect(html).toContain('—');
    expect(html).not.toContain('NaN');
    expect(html).toContain('No peer data');
  });
});
