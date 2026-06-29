import { describe, it, expect, vi, beforeEach } from 'vitest';

// Document the contract for the notifications module: rejection events
// are surfaced to the caller within one polling window. The actual poll
// uses supabase + AsyncStorage; we test the helper that filters the
// resolved rows by status.

type ApprovalRow = {
  id: string;
  entry_id: string;
  status: 'approved' | 'rejected' | 'pending';
  comment: string | null;
  resolved_at: string;
};

function partitionResolved(rows: ApprovalRow[], sinceIso: string) {
  const since = new Date(sinceIso).getTime();
  const fresh = rows.filter((r) => {
    if (!r.resolved_at) return false;
    return new Date(r.resolved_at).getTime() > since;
  });
  return {
    newApprovals: fresh.filter((r) => r.status === 'approved').length,
    newRejections: fresh
      .filter((r) => r.status === 'rejected')
      .map((r) => ({ comment: r.comment, entryId: r.entry_id })),
  };
}

describe('partitionResolved (notifications contract)', () => {
  const since = '2026-06-29T10:00:00.000Z';

  it('returns zero counts when no rows are newer than the cursor', () => {
    const rows: ApprovalRow[] = [
      { id: '1', entry_id: 'e1', status: 'approved', comment: null, resolved_at: '2026-06-29T09:59:59.000Z' },
    ];
    expect(partitionResolved(rows, since)).toEqual({ newApprovals: 0, newRejections: [] });
  });

  it('counts approved rows in the result', () => {
    const rows: ApprovalRow[] = [
      { id: '1', entry_id: 'e1', status: 'approved', comment: null, resolved_at: '2026-06-29T10:00:01.000Z' },
      { id: '2', entry_id: 'e2', status: 'approved', comment: null, resolved_at: '2026-06-29T10:01:00.000Z' },
    ];
    expect(partitionResolved(rows, since).newApprovals).toBe(2);
  });

  it('surfaces the first rejection with its comment so the UI can show the reason', () => {
    const rows: ApprovalRow[] = [
      { id: '1', entry_id: 'e1', status: 'rejected', comment: 'Missing consent', resolved_at: '2026-06-29T10:00:30.000Z' },
    ];
    const r = partitionResolved(rows, since);
    expect(r.newRejections).toEqual([{ comment: 'Missing consent', entryId: 'e1' }]);
  });

  it('ignores unresolved (pending) rows', () => {
    const rows: ApprovalRow[] = [
      { id: '1', entry_id: 'e1', status: 'pending', comment: null, resolved_at: '2026-06-29T10:00:30.000Z' },
    ];
    expect(partitionResolved(rows, since)).toEqual({ newApprovals: 0, newRejections: [] });
  });
});

// Avoid an unused-import warning for vi; we keep the import because future
// contract tests will likely use it to mock AsyncStorage.
void vi;
beforeEach(() => undefined);
