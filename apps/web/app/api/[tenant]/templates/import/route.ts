import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { caseTemplateSchema } from '@elogbook/shared';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { logger } from '@/lib/logger';

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
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, z.unknown(), {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const auth = await requireTenantAdmin(supabase, tenantSlug, DIRECTOR_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const rl = await checkRateLimit(`tpl-import:${tenantSlug}`, 10);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const body = guarded.data as Record<string, unknown>;

  // Handle both formats: direct template object and export wrapper
  let templateData: Record<string, unknown>;
  if (body.template && typeof body.template === 'object') {
    // Export wrapper format: { elogbook_template_version, exported_at, template }
    templateData = body.template as Record<string, unknown>;
  } else if (body.template_data && typeof body.template_data === 'object') {
    // Client wrapper format: { template_data: { template: {...} } }
    const td = body.template_data as Record<string, unknown>;
    templateData = (td.template as Record<string, unknown>) || body.template_data as Record<string, unknown>;
  } else {
    // Direct template object
    templateData = body;
  }

  const parsed = caseTemplateSchema.safeParse(templateData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', parsed.data.name)
    .eq('specialty', parsed.data.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name and specialty already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: parsed.data.name,
      specialty: parsed.data.specialty,
      fields: parsed.data.fields,
      required_fields: parsed.data.required_fields ?? [],
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to import template', error, { tenantSlug, templateName: parsed.data.name });
    return NextResponse.json({ error: 'Failed to import template' }, { status: 500 });
  }

  return NextResponse.json({ template }, { status: 201 });
}
