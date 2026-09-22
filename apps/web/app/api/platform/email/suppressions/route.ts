// apps/web/app/api/platform/email/suppressions/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const deleteSchema = z.object({ email: z.string().email().max(320) });

export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data, error } = await createServiceRoleClient()
    .from('email_suppressions')
    .select('email,reason,tenant_id,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppressions: data ?? [] });
}

export async function DELETE(request: Request) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  let rawEmail = new URL(request.url).searchParams.get('email') ?? '';
  if (!rawEmail) {
    try {
      const body = (await request.json()) as { email?: unknown };
      rawEmail = typeof body.email === 'string' ? body.email : '';
    } catch {
      rawEmail = '';
    }
  }
  const parsed = deleteSchema.safeParse({ email: rawEmail });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }
  const email = parsed.data.email.trim().toLowerCase();

  const admin = createServiceRoleClient();
  const { error } = await admin.from('email_suppressions').delete().eq('email', email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await admin.from('audit_logs').insert({
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      user_id: platform.user.id,
      action: 'email.suppression.remove',
      resource_type: 'email_suppressions',
      resource_id: randomUUID(),
      changes: { email },
    });
  } catch {
    console.warn('[platform-email] audit insert failed for email.suppression.remove', email);
  }

  return NextResponse.json({ success: true, email });
}
