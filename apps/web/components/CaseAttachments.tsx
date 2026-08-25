'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface Attachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  malware_scan_status: string | null;
}

interface CaseAttachmentsProps {
  caseId: string;
  tenantSlug: string;
  tenantId: string;
  viewerProfileId: string;
  viewerRole: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaseAttachments({ caseId, tenantSlug, tenantId, viewerProfileId, viewerRole }: CaseAttachmentsProps) {
  const [supabase] = useState(() => createClient());
  const { show: showToast } = useToast();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = (a: Attachment) =>
    a.uploaded_by === viewerProfileId || ['supervisor', 'director', 'institution_admin', 'admin'].includes(viewerRole);

  const load = useCallback(async () => {
    
    const { data, error: err } = await supabase
      .from('case_attachments')
      .select('id, entry_id, file_path, file_type, file_name, file_size, uploaded_by, uploaded_at, malware_scan_status')
      .eq('entry_id', caseId)
      .order('uploaded_at', { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    setAttachments((data ?? []) as Attachment[]);
    setLoading(false);
  }, [caseId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    setError(null);
    if (file.size > MAX_FILE_SIZE) {
      setError('File exceeds the 10MB limit.');
      return;
    }
    
    setUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user?.id ?? '')
      .single();

    const id = crypto.randomUUID();
    const path = `${tenantSlug}/${caseId}/${id}-${file.name.replace(/[^\w.-]+/g, '_')}`;

    const { error: upErr } = await supabase.storage
      .from('case-attachments')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }

    const { error: insErr } = await supabase.from('case_attachments').insert({
      id,
      entry_id: caseId,
      tenant_id: tenantId,
      file_path: path,
      file_type: file.type || 'application/octet-stream',
      file_name: file.name,
      file_size: file.size,
      uploaded_by: profile?.id,
    });
    if (insErr) {
      // roll back the orphaned object so storage doesn't accumulate dead files
      await supabase.storage.from('case-attachments').remove([path]);
      setError(insErr.message);
      setUploading(false);
      return;
    }

    showToast('Attachment uploaded', 'success');
    setUploading(false);
    await load();
  }

  async function handleDelete(a: Attachment) {
    
    await supabase.storage.from('case-attachments').remove([a.file_path]);
    const { error: err } = await supabase.from('case_attachments').delete().eq('id', a.id);
    if (err) {
      setError(err.message);
      return;
    }
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
  }

  async function handleDownload(a: Attachment) {
    
    const { data } = await supabase.storage.from('case-attachments').createSignedUrl(a.file_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-5" data-testid="case-attachments">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-text-primary">Attachments</h3>
        <label className="cursor-pointer text-sm px-3 py-1.5 rounded-full bg-primary text-white font-medium hover:opacity-90 transition-opacity">
          {uploading ? 'Uploading…' : 'Add file'}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger mb-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-text-muted py-2">Loading…</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-text-muted py-2">No attachments yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 gap-3">
              <button
                type="button"
                onClick={() => handleDownload(a)}
                className="text-sm text-primary hover:underline text-left truncate min-w-0"
                title={a.file_name ?? a.file_path}
              >
                {a.file_name ?? a.file_path.split('/').pop()}
                <span className="text-text-muted ml-2 text-xs">{formatSize(a.file_size)}</span>
                {a.malware_scan_status === 'infected' && (
                  <span className="ml-2 text-xs text-danger">[blocked]</span>
                )}
              </button>
              {canDelete(a) && (
                <button
                  type="button"
                  aria-label={`Delete ${a.file_name ?? 'attachment'}`}
                  onClick={() => handleDelete(a)}
                  className="text-xs text-text-muted hover:text-danger transition-colors shrink-0"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
