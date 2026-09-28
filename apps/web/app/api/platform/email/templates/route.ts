// apps/web/app/api/platform/email/templates/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const upsertSchema = z.object({
  key: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000),
  text: z.string().max(100000).optional().nullable(),
  active: z.boolean().optional(),
}).strict();

export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data, error } = await createServiceRoleClient()
    .from('email_templates')
    .select('key,subject,html,text,version,active,updated_at')
    .order('key');
  if (error) {
    logger.error('Failed to list email templates', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const guarded = await guardRequest(request, upsertSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 128 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  const parsed = { data: guarded.data, success: true as const };

  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from('email_templates')
    .select('version')
    .eq('key', parsed.data.key)
    .maybeSingle();
  const version = ((existing as { version?: number } | null)?.version ?? 0) + 1;

  const { data: template, error } = await admin
    .from('email_templates')
    .upsert(
      {
        key: parsed.data.key,
        subject: parsed.data.subject,
        html: parsed.data.html,
        text: parsed.data.text ?? null,
        active: parsed.data.active ?? true,
        version,
        updated_by: platform.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    .select('key,subject,html,text,version,active,updated_at')
    .single();
  if (error || !template) {
    logger.error('Failed to upsert email template', error, { key: parsed.data.key });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  try {
    await admin.from('audit_logs').insert({
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      user_id: platform.user.id,
      action: 'email.template.update',
      resource_type: 'email_templates',
      resource_id: randomUUID(),
      changes: { key: parsed.data.key, version },
    });
  } catch (auditError) {
    logger.warn('Failed to audit email template update', { key: parsed.data.key, error: auditError });
  }

  return NextResponse.json({ template });
}
