/**
 * Case comments adapter — approved writer for the `comments` table.
 * Reads are tenant-scoped by RLS; inserts must set the caller's profile id
 * (the policy checks author_id = self) and the entry's tenant.
 */

import { supabase } from './supabase';

export interface CaseComment {
  id: string;
  entry_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  author_name: string;
}

export async function listCaseComments(
  entryId: string,
): Promise<{ comments: CaseComment[]; error: string | null }> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, entry_id, parent_id, author_id, body, created_at, profiles!author_id(full_name)')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) return { comments: [], error: error.message };

  const comments = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const profile = row.profiles as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(profile) ? profile[0]?.full_name : profile?.full_name;
    return {
      id: row.id as string,
      entry_id: row.entry_id as string,
      parent_id: (row.parent_id as string | null) ?? null,
      author_id: row.author_id as string,
      body: row.body as string,
      created_at: row.created_at as string,
      author_name: name ?? 'Unknown',
    };
  });

  return { comments, error: null };
}

export async function addCaseComment(input: {
  entryId: string;
  tenantId: string;
  authorId: string;
  body: string;
  parentId?: string | null;
}): Promise<{ ok: boolean; error: string | null }> {
  const body = input.body.trim().slice(0, 2000);
  if (!body) return { ok: false, error: 'Comment cannot be empty.' };

  const { error } = await supabase.from('comments').insert({
    tenant_id: input.tenantId,
    entry_id: input.entryId,
    parent_id: input.parentId ?? null,
    author_id: input.authorId,
    body,
  });
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

export async function deleteCaseComment(commentId: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}
