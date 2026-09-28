import { NextResponse } from 'next/server';
import {
  MAX_ATTACHMENT_BYTES,
  validateAttachmentUpload,
  type AttachmentValidationResult,
} from '@/lib/attachments/upload-policy';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { getAttachmentScannerReadiness } from '@/lib/attachments/scanner-config';

const PRIVILEGED_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'missing' | 'too_large' };

async function readBoundedBody(request: Request): Promise<BodyReadResult> {
  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function validationStatus(result: Extract<AttachmentValidationResult, { ok: false }>): number {
  if (result.code === 'too_large') return 413;
  if (result.code === 'unsupported_type' || result.code === 'extension_mismatch') return 415;
  if (result.code === 'count_exceeded') return 409;
  return 400;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;
  const security = await getSecurityContext();
  if (!security.ok) {
    return NextResponse.json({ error: 'Attachment access denied' }, { status: security.status });
  }
  if (security.context.tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
  }

  const caseId = request.headers.get('x-attachment-case-id') ?? '';
  const encodedFileName = request.headers.get('x-attachment-file-name') ?? '';
  if (!UUID_PATTERN.test(caseId) || encodedFileName.length === 0 || encodedFileName.length > 1024) {
    return NextResponse.json({ error: 'Invalid attachment metadata' }, { status: 400 });
  }

  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedFileName);
  } catch {
    return NextResponse.json({ error: 'Invalid attachment metadata' }, { status: 400 });
  }

  const contentLengthValue = request.headers.get('content-length');
  let contentLength: number | null = null;
  if (contentLengthValue !== null) {
    if (!/^\d+$/.test(contentLengthValue)) {
      return NextResponse.json({ error: 'Invalid content length' }, { status: 400 });
    }
    contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength)) {
      return NextResponse.json({ error: 'Invalid content length' }, { status: 400 });
    }
    if (contentLength > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: 'Attachment exceeds the 10 MiB limit' }, { status: 413 });
    }
  }

  const admin = createServiceRoleClient();
  const { data: caseEntry, error: caseError } = await admin
    .from('case_entries')
    .select('id, tenant_id, resident_id')
    .eq('id', caseId)
    .eq('tenant_id', security.context.tenant.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (caseError || !caseEntry) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const canUpload = security.context.profile.id === caseEntry.resident_id
    || PRIVILEGED_ROLES.has(security.context.profile.role);
  if (!canUpload) {
    return NextResponse.json({ error: 'Case attachment access denied' }, { status: 403 });
  }

  const { data: scannerConfig, error: scannerConfigError } = await admin
    .from('attachment_security_config')
    .select('scanner_enabled, connector_approved, scanner_connector_id, scanner_connector_revision, scanner_approval_reference, scanner_timeout_ms, max_scan_bytes')
    .eq('id', 1)
    .maybeSingle();
  if (
    scannerConfigError
    || !getAttachmentScannerReadiness(scannerConfig, {
      ...process.env,
      ATTACHMENT_SCANNER_MAX_BYTES: process.env.ATTACHMENT_SCANNER_MAX_BYTES ?? String(MAX_ATTACHMENT_BYTES),
    }).ready
  ) {
    return NextResponse.json({
      error: 'Attachment scanning is unavailable',
      remediation: 'Configure an approved scanner connector before uploading attachments.',
    }, { status: 503 });
  }

  const body = await readBoundedBody(request);
  if (!body.ok) {
    const status = body.reason === 'too_large' ? 413 : 400;
    return NextResponse.json({ error: 'Invalid attachment body' }, { status });
  }
  if (contentLength !== null && contentLength !== body.bytes.byteLength) {
    return NextResponse.json({ error: 'Content length does not match attachment body' }, { status: 400 });
  }

  const { count, error: countError } = await admin
    .from('case_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('entry_id', caseId)
    .eq('tenant_id', security.context.tenant.id);
  if (countError) {
    return NextResponse.json({ error: 'Unable to verify attachment count' }, { status: 500 });
  }

  const validation = validateAttachmentUpload({
    bytes: body.bytes,
    fileName,
    currentCount: count ?? 0,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: validationStatus(validation) });
  }

  const id = crypto.randomUUID();
  const objectPath = `${security.context.tenant.slug}/quarantine/${caseId}/${id}-${validation.value.fileName}`;
  const storageBody = new Uint8Array(body.bytes).buffer;
  const { error: uploadError } = await admin.storage
    .from('case-attachments')
    .upload(objectPath, storageBody, {
      contentType: validation.value.mediaType,
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json({ error: 'Unable to quarantine attachment' }, { status: 503 });
  }

  const { error: insertError } = await admin.from('case_attachments').insert({
    id,
    entry_id: caseId,
    tenant_id: security.context.tenant.id,
    file_path: objectPath,
    file_type: validation.value.mediaType,
    file_name: validation.value.fileName,
    file_size: validation.value.size,
    uploaded_by: security.context.profile.id,
    mime_signature: validation.value.mediaType,
    malware_scan_status: 'pending',
  });
  if (insertError) {
    await admin.storage.from('case-attachments').remove([objectPath]);
    return NextResponse.json({ error: 'Unable to register quarantined attachment' }, { status: 503 });
  }

  return NextResponse.json({ id, status: 'pending' }, { status: 202 });
}
