// apps/web/app/api/platform/email/templates/[key]/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const updateSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000),
  text: z.string().max(100000).optional().nullable(),
  active: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { key } = await params;
  const { data, error } = await createServiceRoleClient()
    .from('email_templates')
    .select('key,subject,html,text,version,active,updated_at')
    .eq('key', key)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { key } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from('email_templates')
    .select('version')
    .eq('key', key)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  const version = ((existing as { version?: number }).version ?? 0) + 1;

  const patch: Record<string, unknown> = {
    subject: parsed.data.subject,
    html: parsed.data.html,
    version,
    updated_by: platform.user.id,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;

  const { data: template, error } = await admin
    .from('email_templates')
    .update(patch)
    .eq('key', key)
    .select('key,subject,html,text,version,active,updated_at')
    .single();
  if (error || !template) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  }

  try {
    await admin.from('audit_logs').insert({
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      user_id: platform.user.id,
      action: 'email.template.update',
      resource_type: 'email_templates',
      resource_id: randomUUID(),
      changes: { key, version },
    });
  } catch {
    console.warn('[platform-email] audit insert failed for email.template.update', key);
  }

  return NextResponse.json({ template });
}
