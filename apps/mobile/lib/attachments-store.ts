/**
 * Case attachment store — the approved adapter for `case_attachments` writes.
 *
 * `scripts/check-mobile-adapters.mjs` requires every sensitive-table write to
 * live behind an adapter import. Keeping storage + row writes here also puts
 * the path/MIME/size rules in one place, matching the web's CaseAttachments.
 *
 * Path contract (storage RLS): `{tenantSlug}/{caseId}/{id}-{safeName}`.
 */

import { randomUUID } from 'expo-crypto';
import { supabase } from './supabase';
import { validateAttachment } from './attachments';

export interface CaseAttachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

export interface LocalFile {
  uri: string;
  name: string;
  mime: string;
  sizeBytes: number;
}

export interface UploadInput {
  caseId: string;
  tenantId: string;
  tenantSlug: string;
  profileId: string;
  file: LocalFile;
}

export async function listCaseAttachments(
  caseId: string,
): Promise<{ data: CaseAttachment[]; error: string | null }> {
  const { data, error } = await supabase
    .from('case_attachments')
    .select('id, entry_id, file_path, file_type, file_name, file_size, uploaded_by, uploaded_at')
    .eq('entry_id', caseId)
    .order('uploaded_at', { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as CaseAttachment[], error: null };
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'attachment';
}

export async function uploadCaseAttachment(
  input: UploadInput,
): Promise<{ ok: true; attachment: CaseAttachment } | { ok: false; error: string }> {
  const name = safeName(input.file.name);
  const check = validateAttachment({
    mime: input.file.mime,
    sizeBytes: input.file.sizeBytes,
    name,
  });
  if (!check.ok) return { ok: false, error: check.reason ?? 'file not allowed' };

  let body: ArrayBuffer;
  try {
    body = await (await fetch(input.file.uri)).arrayBuffer();
  } catch {
    return { ok: false, error: 'Could not read the selected file.' };
  }

  // Trust the bytes we actually send, not a picker-reported size.
  if (body.byteLength === 0 || body.byteLength > 10 * 1024 * 1024) {
    return { ok: false, error: 'File must be between 1 byte and 10 MB.' };
  }

  const id = randomUUID();
  const path = `${input.tenantSlug}/${input.caseId}/${id}-${name}`;

  const { error: uploadError } = await supabase.storage
    .from('case-attachments')
    .upload(path, body, { contentType: input.file.mime, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: insertError } = await supabase.from('case_attachments').insert({
    id,
    entry_id: input.caseId,
    tenant_id: input.tenantId,
    file_path: path,
    file_type: input.file.mime,
    file_name: name,
    file_size: body.byteLength,
    uploaded_by: input.profileId,
  });

  if (insertError) {
    // Roll back the orphaned object so storage does not accumulate it.
    await supabase.storage.from('case-attachments').remove([path]);
    return { ok: false, error: insertError.message };
  }

  return {
    ok: true,
    attachment: {
      id,
      entry_id: input.caseId,
      file_path: path,
      file_type: input.file.mime,
      file_name: name,
      file_size: body.byteLength,
      uploaded_by: input.profileId,
      uploaded_at: new Date().toISOString(),
    },
  };
}

export async function deleteCaseAttachment(
  attachment: CaseAttachment,
): Promise<{ ok: boolean; error: string | null }> {
  await supabase.storage.from('case-attachments').remove([attachment.file_path]);
  const { error } = await supabase.from('case_attachments').delete().eq('id', attachment.id);
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

export async function caseAttachmentUrl(
  attachment: CaseAttachment,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from('case-attachments')
    .createSignedUrl(attachment.file_path, 60);
  return error || !data?.signedUrl
    ? { url: null, error: error?.message ?? 'No link was returned.' }
    : { url: data.signedUrl, error: null };
}
