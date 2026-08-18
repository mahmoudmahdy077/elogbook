'use client';

import { useState, useEffect } from 'react';
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
  users: User[];
  currentUserRole: string;
}

export default function UserManager({ tenantId, users: initialUsers, currentUserRole }: UserManagerProps) {
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

  async function handleRoleChange(userId: string, role: string) {
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);

    if (error) {
      showToast('Failed to update role', 'error');
    } else {
      showToast('Role updated successfully', 'success');
      setEditingUser(null);
      loadUsers();
    }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm('Are you sure you want to deactivate this user?')) return;

    // In a real app, you'd soft-delete or disable the user
    // For now, we'll just show a message
    showToast('User deactivation is not implemented yet', 'info');
  }

  const roleColors: Record<string, string> = {
    resident: 'bg-primary/10 text-primary',
    supervisor: 'bg-secondary/10 text-secondary',
    director: 'bg-success/10 text-success',
    institution_admin: 'bg-warning/10 text-warning',
    admin: 'bg-danger/10 text-danger',
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
                        >
                          Save
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
                          className="px-3 py-1 rounded text-xs font-medium border border-danger text-danger hover:bg-danger/10"
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
