// apps/web/app/api/platform/email/logs/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data } = await createServiceRoleClient().from('email_logs').select('id,to_email,template_key,provider,status,error,created_at').order('created_at', { ascending: false }).limit(50);
  const masked = ((data as { to_email: string }[] | null) ?? []).map((r) => ({ ...r, to_email: r.to_email.replace(/^(.).*(@.*)$/, '$1***$2') }));
  return NextResponse.json({ logs: masked });
}
