import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';

const PRIVILEGED_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

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
    .select('id, tenant_id, file_path, uploaded_by')
    .eq('id', id)
    .eq('tenant_id', security.context.tenant.id)
    .maybeSingle();
  if (error || !attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  const canDelete = security.context.profile.id === attachment.uploaded_by
    || PRIVILEGED_ROLES.has(security.context.profile.role);
  if (!canDelete) {
    return NextResponse.json({ error: 'Attachment access denied' }, { status: 403 });
  }

  const { error: storageError } = await admin.storage
    .from('case-attachments')
    .remove([attachment.file_path]);
  if (storageError) {
    return NextResponse.json({ error: 'Unable to delete attachment object' }, { status: 503 });
  }

  const { error: deleteError } = await admin
    .from('case_attachments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', security.context.tenant.id);
  if (deleteError) {
    return NextResponse.json({ error: 'Unable to delete attachment metadata' }, { status: 503 });
  }

  return NextResponse.json({ success: true });
}
