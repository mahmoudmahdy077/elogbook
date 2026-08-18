import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .select('name, specialty, fields, required_fields')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const exportData = {
    elogbook_template_version: 1,
    exported_at: new Date().toISOString(),
    template,
  };

  return NextResponse.json(exportData, {
    headers: {
      'Content-Disposition': `attachment; filename="${template.name.replace(/[^a-z0-9]/gi, '_')}.json"`,
    },
  });
}
