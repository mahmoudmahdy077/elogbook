import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ConsentRow from './ConsentRow';

const CONSENT_TYPES = [
  {
    key: 'data_processing',
    label: 'Data processing',
    description: 'Allow E-Logbook to process your case data for accreditation reporting.',
  },
  {
    key: 'ai_insights',
    label: 'AI insights',
    description: 'Allow E-Logbook to summarize your cases with on-device AI.',
  },
  {
    key: 'data_export',
    label: 'Data export',
    description: 'Allow exporting your data as PDF or CSV from the web app.',
  },
  {
    key: 'marketing',
    label: 'Product updates',
    description: 'Receive occasional product update emails.',
  },
  {
    key: 'research',
    label: 'Research participation',
    description: 'Include your anonymized data in tenant research aggregates.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description: 'Allow privacy-respecting analytics (PostHog) to record feature usage.',
  },
  {
    key: 'data_sharing',
    label: 'Data sharing',
    description: 'Allow sharing de-identified data with partnering institutions.',
  },
] as const;

interface ConsentRow {
  consent_type: string;
  granted_at: string;
  revoked_at: string | null;
}

export default async function ConsentPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const { data: records } = await supabase
    .from('consent_records')
    .select('consent_type, granted_at, revoked_at')
    .eq('user_id', auth.user.id)
    .eq('tenant_id', auth.profile.tenant_id)
    .order('granted_at', { ascending: false });

  const latestByType = new Map<string, { granted: boolean; grantedAt: string }>();
  for (const r of (records as ConsentRow[] | null) ?? []) {
    if (latestByType.has(r.consent_type)) continue;
    latestByType.set(r.consent_type, {
      granted: r.revoked_at === null,
      grantedAt: r.granted_at,
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-heading font-bold mb-2">Consent management</h1>
      <p className="text-sm text-neutral-light/60 mb-6">
        Withdraw or re-grant consent for each category. Changes apply
        immediately and are recorded in your tenant audit log.
      </p>

      <div className="space-y-3">
        {CONSENT_TYPES.map((t) => {
          const status = latestByType.get(t.key);
          return (
            <ConsentRow
              key={t.key}
              consentType={t.key}
              label={t.label}
              description={t.description}
              granted={status?.granted ?? false}
              tenantId={auth.profile.tenant_id}
            />
          );
        })}
      </div>
    </div>
  );
}
