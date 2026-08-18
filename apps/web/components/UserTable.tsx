'use client';

import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  specialty: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
  deactivated_at: string | null;
}

interface UserTableProps {
  tenantSlug: string;
}

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'resident', label: 'Resident' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'director', label: 'Director' },
  { value: 'institution_admin', label: 'Institution Admin' },
  { value: 'admin', label: 'Admin' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deactivated', label: 'Deactivated' },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  suspended: 'bg-danger/10 text-danger',
  deactivated: 'bg-neutral-dark text-text-muted',
};

const ROLE_COLORS: Record<string, string> = {
  resident: 'bg-primary/10 text-primary',
  supervisor: 'bg-primary/10 text-primary',
  director: 'bg-warning/10 text-warning',
  institution_admin: 'bg-danger/10 text-danger',
  admin: 'bg-success/10 text-success',
};

export default function UserTable({ tenantSlug }: UserTableProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/${tenantSlug}/admin/users?${params}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotalPages(data.pages ?? 1);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, page, search, roleFilter, statusFilter]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAction = useCallback(async (userId: string, action: string, body?: Record<string, unknown>) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/users/${userId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      loadUsers();
    } finally {
      setActionLoading(null);
    }
  }, [tenantSlug, loadUsers]);

  const handleBulkAction = useCallback(async (action: string) => {
    if (selectedUsers.length === 0) return;
    for (const userId of selectedUsers) {
      await handleAction(userId, action);
    }
    setSelectedUsers([]);
  }, [selectedUsers, handleAction]);

  const handleDelete = useCallback(async (userId: string) => {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      loadUsers();
    } finally {
      setActionLoading(null);
    }
  }, [tenantSlug, loadUsers]);

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or specialty..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm flex-1 min-w-[200px]"
        />
        <select
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm"
        >
          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Bulk Actions */}
      {selectedUsers.length > 0 && (
        <div className="flex gap-2 items-center p-2 rounded-lg bg-primary/10">
          <span className="text-sm">{selectedUsers.length} selected</span>
          <button onClick={() => handleBulkAction('deactivate')} className="px-2 py-1 rounded text-xs border border-border hover:bg-neutral-dark/50">Deactivate</button>
          <button onClick={() => handleBulkAction('reactivate')} className="px-2 py-1 rounded text-xs border border-border hover:bg-neutral-dark/50">Reactivate</button>
          <button onClick={() => setSelectedUsers([])} className="px-2 py-1 rounded text-xs border border-border hover:bg-neutral-dark/50">Clear</button>
        </div>
      )}

      {/* User Table */}
      {loading ? (
        <div className="text-center py-8 text-text-muted">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-8 text-text-muted">No users found</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3">
                  <input
                    type="checkbox"
                    checked={selectedUsers.length === users.length && users.length > 0}
                    onChange={e => setSelectedUsers(e.target.checked ? users.map(u => u.id) : [])}
                    className="rounded"
                  />
                </th>
                <th className="text-left py-2 px-3">Name</th>
                <th className="text-left py-2 px-3">Role</th>
                <th className="text-left py-2 px-3">Specialty</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Joined</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-border hover:bg-neutral-dark/30">
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(u.id)}
                      onChange={e => setSelectedUsers(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                      className="rounded"
                    />
                  </td>
                  <td className="py-2 px-3 font-medium">{u.full_name}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${ROLE_COLORS[u.role] || ''}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-text-muted">{u.specialty || '—'}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[u.status] || ''}`}>
                      {u.status || 'active'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-text-muted text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => setEditingUser(u)}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-neutral-dark/50"
                      >
                        Edit
                      </button>
                      {u.status !== 'deactivated' ? (
                        <button
                          onClick={() => handleAction(u.id, 'deactivate')}
                          disabled={actionLoading === u.id}
                          className="px-2 py-1 rounded text-xs border border-warning/30 text-warning hover:bg-warning/10"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(u.id, 'reactivate')}
                          disabled={actionLoading === u.id}
                          className="px-2 py-1 rounded text-xs border border-success/30 text-success hover:bg-success/10"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(u.id, 'reset-password')}
                        disabled={actionLoading === u.id}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-neutral-dark/50"
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={actionLoading === u.id}
                        className="px-2 py-1 rounded text-xs border border-danger/30 text-danger hover:bg-danger/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50">Prev</button>
          <span className="px-3 py-1 text-sm text-text-muted">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50">Next</button>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          tenantSlug={tenantSlug}
          onClose={() => setEditingUser(null)}
          onSave={() => { setEditingUser(null); loadUsers(); }}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, tenantSlug, onClose, onSave }: { user: User; tenantSlug: string; onClose: () => void; onSave: () => void }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [specialty, setSpecialty] = useState(user.specialty || '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status || 'active');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, specialty, role, status }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-panel p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold mb-4">Edit User</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs mb-1 text-text-muted">Full Name</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
          </div>
          <div>
            <label className="block text-xs mb-1 text-text-muted">Specialty</label>
            <input value={specialty} onChange={e => setSpecialty(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
          </div>
          <div>
            <label className="block text-xs mb-1 text-text-muted">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm">
              {['resident', 'supervisor', 'director', 'institution_admin', 'admin'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1 text-text-muted">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm">
              {['active', 'pending', 'suspended', 'deactivated'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
