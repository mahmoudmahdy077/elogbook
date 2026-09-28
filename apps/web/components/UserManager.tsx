'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface User {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  specialty: string | null;
  tenant_id: string;
  tenants?: { name: string; slug: string };
}

interface UserManagerProps {
  tenantId: string;
  tenantSlug: string;
  users: User[];
  currentUserRole: string;
}

export default function UserManager({ tenantId, users: initialUsers, tenantSlug, currentUserRole: _currentUserRole }: UserManagerProps) {
  const [users, setUsers] = useState<User[]>(initialUsers || []);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newRole, setNewRole] = useState('');
  const { show: showToast } = useToast();
  const supabase = createClient();

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*, tenants!inner(name, slug)')
      .eq('tenant_id', tenantId)
      .order('full_name');
    setUsers(data || []);
    setLoading(false);
  }

  /**
   * A role is an authorization column. It changes only through
   * PUT /api/[tenant]/admin/users/[id], which requires an authenticated AAL2
   * administrator and runs public.admin_update_profile. A direct
   * `profiles.update({ role })` from the browser is a bypass of that RPC, and
   * it also skipped the last-administrator protection entirely.
   */
  async function handleRoleChange(profileId: string, role: string) {
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/users/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'Failed to update role', 'error');
        return;
      }
      showToast('Role updated successfully', 'success');
      setEditingUser(null);
      loadUsers();
    } catch {
      showToast('Failed to update role', 'error');
    }
  }

  /**
   * Status is an authorization column for the same reason; it goes through
   * POST /api/[tenant]/admin/users/[id]/action, which also revokes the target
   * user's auth sessions.
   */
  async function handleDeactivate(profileId: string) {
    if (!confirm('Are you sure you want to deactivate this user?')) return;

    try {
      const res = await fetch(`/api/${tenantSlug}/admin/users/${profileId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'Failed to deactivate user', 'error');
        return;
      }
      showToast('User deactivated', 'success');
      loadUsers();
    } catch {
      showToast('Failed to deactivate user', 'error');
    }
  }

  const roleColors: Record<string, string> = {
    resident: 'bg-primary/10 text-fg-primary',
    supervisor: 'bg-secondary/10 text-secondary',
    director: 'bg-success/10 text-fg-success',
    institution_admin: 'bg-warning/10 text-fg-warning',
    admin: 'bg-danger/10 text-fg-danger',
  };

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">User Management</h2>
        <span className="text-sm text-text-muted">{users.length} users</span>
      </div>

      {loading ? (
        <div className="text-center py-8 text-text-muted">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-8 text-text-muted">No users found</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-medium text-text-muted">Name</th>
                <th className="text-left py-2 font-medium text-text-muted">Email</th>
                <th className="text-left py-2 font-medium text-text-muted">Role</th>
                <th className="text-left py-2 font-medium text-text-muted">Specialty</th>
                <th className="text-right py-2 font-medium text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-divider hover:bg-neutral-dark">
                  <td className="py-3 text-text-primary font-medium">{user.full_name || 'N/A'}</td>
                  <td className="py-3 text-text-secondary">
                    {editingUser?.id === user.id ? (
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        className="px-2 py-1 rounded border border-border bg-surface text-sm"
                      >
                        <option value="resident">Resident</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="director">Director</option>
                        <option value="institution_admin">Institution Admin</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] || 'bg-default-100 text-text-muted'}`}>
                        {user.role}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-text-secondary">{user.tenants?.name || 'N/A'}</td>
                  <td className="py-3 text-text-secondary">{user.specialty || '—'}</td>
                  <td className="py-3 text-right">
                    {editingUser?.id === user.id ? (
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleRoleChange(user.id, newRole)}
                          className="px-3 py-1 rounded text-xs font-medium bg-primary text-white hover:opacity-90"
                        >                          Save
                        </button>
                        <button
                          onClick={() => setEditingUser(null)}
                          className="px-3 py-1 rounded text-xs font-medium border border-border text-text-secondary hover:bg-neutral-dark"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setEditingUser(user); setNewRole(user.role); }}
                          className="px-3 py-1 rounded text-xs font-medium border border-border text-text-secondary hover:bg-neutral-dark"
                        >
                          Edit Role
                        </button>
                        <button
                          onClick={() => handleDeactivate(user.id)}
                          className="px-3 py-1 rounded text-xs font-medium border border-danger text-fg-danger hover:bg-danger/10"
                        >
                          Deactivate
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
