import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import InviteMentor from '@/components/InviteMentor';

export default async function InvitesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  // Get pending invites for this tenant
  const { data: invites } = await supabase
    .from('tenant_invites')
    .select('*')
    .eq('tenant_id', auth.tenant.id)
    .order('created_at', { ascending: false });

  // Get registration link
  const regLink = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/signup?tenant=${tenantSlug}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-text-muted mt-1">
          Invite users, import email lists, and manage registration for your institution.
        </p>
      </div>

      {/* Registration Link Section */}
      <div className="panel p-6">
        <h2 className="text-lg font-semibold mb-4">Registration Link</h2>
        <p className="text-sm text-text-muted mb-3">
          Share this link with residents and program directors to register directly into your institution.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={regLink}
            readOnly
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
          />
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                navigator.clipboard.writeText(regLink);
              }
            }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Invite Section */}
      <InviteMentor tenantSlug={tenantSlug} tenantId={auth.tenant.id} />

      {/* Pending Invites */}
      {invites && invites.length > 0 && (
        <div className="panel p-6">
          <h2 className="text-lg font-semibold mb-4">Pending Invites ({invites.length})</h2>
          <div className="space-y-3">
            {invites.map((invite: { id: string; email: string; role: string; status: string; created_at: string }) => (
              <div key={invite.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-text-muted">
                    Role: {invite.role} · Invited {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  invite.status === 'pending' ? 'bg-warning/10 text-warning' :
                  invite.status === 'accepted' ? 'bg-success/10 text-success' :
                  'bg-default-100 text-text-muted'
                }`}>
                  {invite.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
