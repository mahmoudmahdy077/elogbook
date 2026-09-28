// apps/web/app/api/platform/email/suppressions/route.ts
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

const deleteSchema = z.object({ email: z.string().email().max(320) }).strict();

export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data, error } = await createServiceRoleClient()
    .from('email_suppressions')
    .select('email,reason,tenant_id,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    logger.error('Failed to list email suppressions', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ suppressions: data ?? [] });
}

export async function DELETE(request: Request) {
  const queryEmail = new URL(request.url).searchParams.get('email') ?? '';
  const guarded = queryEmail
    ? await guardRequest(request, undefined, {
        trustedOrigins: defaultTrustedOrigins(request),
        requireBody: false,
      })
    : await guardRequest(request, deleteSchema, {
        trustedOrigins: defaultTrustedOrigins(request),
        maxBodyBytes: 4 * 1024,
      });
  if (!guarded.ok) return guarded.response;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  let email: string;
  if (queryEmail) {
    const parsed = deleteSchema.safeParse({ email: queryEmail });
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    email = parsed.data.email.trim().toLowerCase();
  } else {
    email = (guarded.data as { email: string }).email.trim().toLowerCase();
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from('email_suppressions').delete().eq('email', email);
  if (error) {
    logger.error('Failed to delete email suppression', error, { email });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  try {
    await admin.from('audit_logs').insert({
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      user_id: platform.user.id,
      action: 'email.suppression.remove',
      resource_type: 'email_suppressions',
      resource_id: randomUUID(),
      changes: { email },
    });
  } catch (auditError) {
    logger.warn('Failed to audit email suppression removal', { email, error: auditError });
  }

  return NextResponse.json({ success: true, email });
}
