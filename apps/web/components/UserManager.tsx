'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import ImpactDialog from '@/components/ImpactDialog';
import { createClient } from '@/lib/supabase/client';

interface Profile {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  full_name: string;
  specialty: string | null;
  created_at: string;
  updated_at: string;
}

interface UserManagerProps {
  tenantId: string;
  users: Profile[];
  currentUserRole: string;
}

const ROLE_OPTIONS = [
  { key: 'resident', label: 'Resident' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'director', label: 'Director' },
  { key: 'institution_admin', label: 'Institution Admin' },
];

const ROLE_COLORS: Record<string, string> = {
  resident: 'bg-[rgba(0,122,255,0.12)] text-[#007AFF]',
  supervisor: 'bg-[rgba(0,122,255,0.12)] text-[#007AFF]',
  director: 'bg-[rgba(255,149,0,0.12)] text-[#FF9500]',
  institution_admin: 'bg-[rgba(255,59,48,0.12)] text-[#FF3B30]',
  admin: 'bg-[rgba(52,199,89,0.12)] text-[#34C759]',
};

export default function UserManager({ tenantId, users, currentUserRole }: UserManagerProps) {
  const router = useRouter();
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('resident');
  const [inviteSpecialty, setInviteSpecialty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ userId: string; newRole: string; userName: string } | null>(null);

  function resetForm() {
    setInviteEmail('');
    setInviteName('');
    setInviteRole('resident');
    setInviteSpecialty('');
    setError('');
  }

  async function handleInvite() {
    setError('');
    setSuccess('');

    if (!inviteEmail.trim() || !inviteName.trim()) {
      setError('Email and Full Name are required.');
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error: inviteError } = await supabase.auth.signInWithOtp({
      email: inviteEmail.trim(),
      options: {
        data: {
          full_name: inviteName.trim(),
          specialty: inviteSpecialty || null,
        },
      },
    });

    if (inviteError) {
      setError(inviteError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    setSuccess(`Invitation sent to ${inviteEmail}. Role will need to be assigned separately.`);
    resetForm();
    router.refresh();
    setShowInviteModal(false);
  }

  async function doRoleChange() {
    if (!roleChangeTarget) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/${tenantId}/admin/assign-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: roleChangeTarget.userId, role: roleChangeTarget.newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update role.');
        setLoading(false);
        return;
      }

      router.refresh();
      setShowRoleDialog(false);
      setRoleChangeTarget(null);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmRoleChange(userId: string, newRole: string, userName: string) {
    setRoleChangeTarget({ userId, newRole, userName });
    setShowRoleDialog(true);
  }

  return (
    <>
      <div>
        {error && <ErrorDisplay message={error} />}
      {success && (
        <div className="bg-[rgba(52,199,89,0.10)] text-[#34C759] p-3 rounded-lg text-sm mb-4">{success}</div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <button
          type="button"
          onClick={() => setShowInviteModal(true)}
          className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Invite User
        </button>
      </div>

      {users.length === 0 ? (
        <p className="text-text-muted">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Users table">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="pb-3 font-semibold text-text-muted">Name</th>
                <th className="pb-3 font-semibold text-text-muted">Role</th>
                <th className="pb-3 font-semibold text-text-muted">Specialty</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-divider">
                  <td className="py-2.5">{u.full_name}</td>
                  <td className="py-2.5">
                    {['institution_admin', 'admin'].includes(currentUserRole) ? (
                      <select
                        value={u.role}
                        onChange={(e) => {
                          if (e.target.value !== u.role) {
                            confirmRoleChange(u.id, e.target.value, u.full_name);
                          }
                        }}
                        aria-label="Role"
                        className="rounded-lg bg-neutral-dark border border-border px-2 py-1.5 text-sm"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] || 'bg-default-100 text-text-muted'}`}>
                        {u.role}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">{u.specialty || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowInviteModal(false)}>
          <div className="panel p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold mb-4">Invite User</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="user@example.com"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Full Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                  placeholder="Full name"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                  aria-label="Select role"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Specialty</label>
                <input
                  type="text"
                  value={inviteSpecialty}
                  onChange={(e) => setInviteSpecialty(e.target.value)}
                  placeholder="e.g. Cardiology"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInvite}
                disabled={loading}
                className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
                  loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}
        <ImpactDialog
          isOpen={showRoleDialog}
          title="Change User Role"
          message={roleChangeTarget ? `Change ${roleChangeTarget.userName}'s role to ${roleChangeTarget.newRole}?` : ''}
          severity="warning"
          confirmLabel="Change Role"
          loading={loading}
          onConfirm={doRoleChange}
          onCancel={() => { setShowRoleDialog(false); setRoleChangeTarget(null); }}
        />
      </div>
    </>
  );
}
