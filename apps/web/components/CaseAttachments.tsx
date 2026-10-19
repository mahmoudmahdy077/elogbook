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
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt', '.csv']);

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaseAttachments({ caseId, tenantSlug, viewerProfileId, viewerRole }: CaseAttachmentsProps) {
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
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError('Invalid file type. Allowed: JPG, PNG, GIF, WebP, PDF, DOC, DOCX, TXT, CSV.');
      return;
    }
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      setError('Invalid file extension.');
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/${encodeURIComponent(tenantSlug)}/attachments/upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-attachment-case-id': caseId,
          'x-attachment-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { error?: string; status?: string };
      if (!response.ok) {
        setError(result.error ?? 'Attachment upload failed.');
        return;
      }
      showToast(
        result.status === 'quarantined' ? 'Attachment uploaded; security scan pending' : 'Attachment uploaded',
        'success',
      );
      await load();
    } catch {
      setError('Attachment upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(a: Attachment) {
    setError(null);
    try {
      const response = await fetch(
        `/api/${encodeURIComponent(tenantSlug)}/attachments/${encodeURIComponent(a.id)}`,
        { method: 'DELETE' },
      );
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? 'Attachment delete failed.');
        return;
      }
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    } catch {
      setError('Attachment delete failed.');
    }
  }

  async function handleDownload(a: Attachment) {
    setError(null);
    try {
      const downloadUrl = `/api/${encodeURIComponent(tenantSlug)}/attachments/${encodeURIComponent(a.id)}/download`;
      const opened = window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      if (!opened) setError('Attachment download popup was blocked.');
    } catch {
      setError('Attachment download failed.');
    }
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

      {error && <p className="text-sm text-fg-danger mb-2">{error}</p>}

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
                className="text-sm text-fg-primary hover:underline text-left truncate min-w-0"
                title={a.file_name ?? a.file_path}
              >
                {a.file_name ?? a.file_path.split('/').pop()}
                <span className="text-text-muted ml-2 text-xs">{formatSize(a.file_size)}</span>
                {a.malware_scan_status === 'infected' && (
                  <span className="ml-2 text-xs text-fg-danger">[blocked]</span>
                )}
              </button>
              {canDelete(a) && (
                <button
                  type="button"
                  aria-label={`Delete ${a.file_name ?? 'attachment'}`}
                  onClick={() => handleDelete(a)}
                  className="text-xs text-text-muted hover:text-fg-danger transition-colors shrink-0"
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
