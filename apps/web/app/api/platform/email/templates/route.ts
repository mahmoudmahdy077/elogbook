// apps/web/app/api/platform/email/templates/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const upsertSchema = z.object({
  key: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000),
  text: z.string().max(100000).optional().nullable(),
  active: z.boolean().optional(),
});

export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data, error } = await createServiceRoleClient()
    .from('email_templates')
    .select('key,subject,html,text,version,active,updated_at')
    .order('key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
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
    return NextResponse.json({ error: error?.message ?? 'Upsert failed' }, { status: 500 });
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
  } catch {
    console.warn('[platform-email] audit insert failed for email.template.update', parsed.data.key);
  }

  return NextResponse.json({ template });
}
