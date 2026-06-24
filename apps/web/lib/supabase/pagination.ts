import { createServerSupabase } from './server';

export interface Cursor {
  created_at: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function decodeCursor(encoded: string): Cursor | null {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString());
  } catch {
    return null;
  }
}

export async function fetchCasesWithCursor(
  residentId: string,
  tenantId: string,
  cursor: Cursor | null,
  pageSize: number
) {
  const supabase = await createServerSupabase();

  let query = supabase
    .from('case_entries')
    .select('id, case_date, patient_mrn, status, case_templates!inner(name, specialty), created_at', { count: 'exact' })
    .eq('resident_id', residentId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const hasMore = (data?.length ?? 0) > pageSize;
  const items = hasMore ? (data?.slice(0, pageSize) ?? []) : (data ?? []);
  const nextCursor = hasMore && items.length > 0
    ? encodeCursor({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })
    : null;

  return { items, nextCursor, hasMore, totalCount: count };
}