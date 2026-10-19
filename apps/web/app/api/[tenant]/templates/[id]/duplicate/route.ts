import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const duplicateSchema = z.object({ name: z.string().trim().min(1).max(200).optional() }).strict();

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

async function safeCreateSupabase() {
  try {
    return await createServerSupabase();
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const guarded = await guardRequest(request, duplicateSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const auth = await requireTenantAdmin(supabase, tenantSlug, DIRECTOR_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const { data: source } = await supabase
    .from('case_templates')
    .select('*')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (!source) {
    return NextResponse.json({ error: 'Source template not found' }, { status: 404 });
  }

  const newName = guarded.data.name || `${source.name} (Copy)`;

  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', newName)
    .eq('specialty', source.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: newName,
      specialty: source.specialty,
      fields: source.fields,
      required_fields: source.required_fields,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to duplicate template', error, { tenantSlug, sourceId: id, newName });
    return NextResponse.json({ error: 'Failed to duplicate template' }, { status: 500 });
  }

  return NextResponse.json({ template }, { status: 201 });
}
