import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cache policy for responses that disclose tenant data.
 *
 * A CSV/HTML/PDF export is a bulk read of PHI-adjacent rows. Once a browser or
 * a CDN is allowed to keep it, the retention story changes: the copy lives
 * somewhere the application cannot audit, revoke, or delete. This gate is
 * source-level on purpose -- it has to hold for every response a route emits,
 * including the error branches nobody writes a test for by hand.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** Comments removed so a doc block that says "no-store" cannot pass the check. */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

const exportRoutes = [
  'apps/web/app/api/[tenant]/audit/export/route.ts',
  'apps/web/app/api/[tenant]/compliance/export/route.ts',
  'apps/web/app/api/[tenant]/reports/duty-hours.csv/route.ts',
  'apps/web/app/api/[tenant]/reports/evaluations.csv/route.ts',
  'apps/web/app/api/[tenant]/reports/specialty.csv/route.ts',
  'apps/web/app/api/[tenant]/reports/status.csv/route.ts',
  'apps/web/app/api/[tenant]/reports/gap-analysis/route.ts',
  'apps/web/app/api/[tenant]/reports/webads/route.ts',
  'apps/web/app/api/[tenant]/export-pdf/route.ts',
];

const NO_STORE_SOURCES = [
  'apps/web/lib/audit/report-export.ts',
  'apps/web/lib/http/control-plane.ts',
];

describe('export cache policy', () => {
  it('exports a shared no-store header set rather than repeating literals', () => {
    const shared = NO_STORE_SOURCES.map(codeOf).join('\n');
    expect(shared).toContain('no-store');
  });

  it.each(exportRoutes)('%s marks its responses no-store', (route) => {
    const code = codeOf(route);
    expect(code).toMatch(/NO_STORE|no-store/);
  });

  it.each(exportRoutes)('%s never emits an ETag for a tenant disclosure', (route) => {
    // A validator lets a cache answer a later request with an earlier one. For
    // an export that is a retention hole, not an optimisation.
    const code = codeOf(route);
    expect(code).not.toMatch(/['"]ETag['"]\s*[:,]/);
    expect(code).not.toMatch(/if-none-match/i);
  });

  it.each(exportRoutes)('%s does not interpolate caller input into a query filter', (route) => {
    // PostgREST filter strings are a small language: `,` and `.` separate
    // clauses, so an interpolated value can append its own filter.
    const code = codeOf(route);
    expect(code).not.toMatch(/\.or\(\s*`/);
    expect(code).not.toMatch(/\.(eq|like|ilike|contains)\(\s*`/);
  });
});

describe('export query hygiene', () => {
  it('audit export reads metadata columns only, never free-text changes', () => {
    const code = codeOf('apps/web/app/api/[tenant]/audit/export/route.ts');
    const select = code.match(/\.select\(([^)]*)\)/)?.[1] ?? '';
    expect(select).not.toContain('changes');
    expect(select).toContain('created_at');
  });

  it('compliance export selects no clinical free text', () => {
    const code = codeOf('apps/web/app/api/[tenant]/compliance/export/route.ts');
    // A compliance report counts records; it does not reprint them.
    for (const forbidden of ['field_values', 'patient_mrn', 'patient_dob', 'notes', 'body']) {
      expect(code).not.toMatch(new RegExp(`select\\([^)]*${forbidden}`));
    }
  });
});
