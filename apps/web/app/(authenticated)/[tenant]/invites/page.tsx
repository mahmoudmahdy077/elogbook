import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import InviteMentor from '@/components/InviteMentor';

export default async function InvitesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  // Invite management is an institution_admin/admin function (matches the
  // API route's role gate); other roles were seeing a permanently-empty list.
  if (!['institution_admin', 'admin'].includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const supabase = await createServerSupabase();

  // Get pending invites for this tenant
  const { data: invites } = await supabase
    .from('tenant_invites')
    .select('*')
    .eq('tenant_id', auth.tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-text-muted mt-1">
          Invite users, import email lists, and manage access for your institution.
        </p>
      </div>

      {/* Invite Section */}
      <InviteMentor tenantSlug={tenantSlug} tenantId={auth.tenant.id} />

      {/* Pending Invites */}
      {invites && invites.length > 0 && (
        <div className="panel p-6">
          <h2 className="text-lg font-semibold mb-4">Invitations ({invites.length})</h2>
          <div className="space-y-3">
            {invites.map((invite: { id: string; email: string; role: string; status: string; created_at: string; expires_at?: string | null }) => {
              const expired = Boolean(
                invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now(),
              );
              const effectiveStatus = invite.status === 'pending' && expired ? 'expired' : invite.status;
              return (
                <div key={invite.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-text-muted">
                      Role: {invite.role} · Invited {new Date(invite.created_at).toLocaleDateString()}
                      {invite.expires_at ? ` · Expires ${new Date(invite.expires_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    effectiveStatus === 'pending' ? 'bg-warning/10 text-fg-warning' :
                    effectiveStatus === 'accepted' ? 'bg-success/10 text-fg-success' :
                    'bg-default-100 text-text-muted'
                  }`}>
                    {effectiveStatus}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
