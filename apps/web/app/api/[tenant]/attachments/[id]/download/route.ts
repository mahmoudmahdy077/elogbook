import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getSecurityContext } from '@/lib/supabase/security-context';

const PRIVILEGED_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_TTL_SECONDS = 60;
const SUPPORTED_CONTENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

function safeDownloadName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const safe = value
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\r\n]/g, '_')
    .trim()
    .slice(0, 180);
  return safe || fallback;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const { tenant: tenantSlug, id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 });
  }

  const security = await getSecurityContext();
  if (!security.ok) {
    return NextResponse.json({ error: 'Attachment access denied' }, { status: security.status });
  }
  if (security.context.tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data: attachment, error } = await admin
    .from('case_attachments')
    .select('id, tenant_id, file_path, file_name, file_type, mime_signature, uploaded_by, malware_scan_status')
    .eq('id', id)
    .eq('tenant_id', security.context.tenant.id)
    .maybeSingle();
  if (error || !attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  const canDownload = security.context.profile.id === attachment.uploaded_by
    || PRIVILEGED_ROLES.has(security.context.profile.role);
  if (!canDownload) {
    return NextResponse.json({ error: 'Attachment access denied' }, { status: 403 });
  }
  if (attachment.malware_scan_status !== 'clean') {
    return NextResponse.json({ error: 'Attachment is not available for download' }, { status: 409 });
  }

  const fallbackName = typeof attachment.file_path === 'string'
    ? attachment.file_path.split('/').pop() || 'attachment'
    : 'attachment';
  const downloadName = safeDownloadName(attachment.file_name, fallbackName);
  const { data, error: signedUrlError } = await admin.storage
    .from('case-attachments')
    .createSignedUrl(attachment.file_path, SIGNED_URL_TTL_SECONDS, { download: downloadName });
  if (signedUrlError || !data?.signedUrl) {
    return NextResponse.json({ error: 'Unable to create attachment download' }, { status: 503 });
  }

  let objectResponse: Response;
  try {
    objectResponse = await fetch(data.signedUrl, {
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return NextResponse.json({ error: 'Unable to retrieve attachment' }, { status: 502 });
  }
  if (!objectResponse.ok || !objectResponse.body) {
    return NextResponse.json({ error: 'Unable to retrieve attachment' }, { status: 502 });
  }

  const contentType = SUPPORTED_CONTENT_TYPES.has(attachment.mime_signature)
    ? attachment.mime_signature
    : 'application/octet-stream';
  const headers = new Headers({
    'cache-control': 'private, no-store, max-age=0',
    'content-disposition': `attachment; filename="${downloadName}"`,
    'content-type': contentType,
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  const upstreamLength = objectResponse.headers.get('content-length');
  if (upstreamLength && /^\d+$/.test(upstreamLength)) headers.set('content-length', upstreamLength);

  return new Response(objectResponse.body, { status: 200, headers });
}
