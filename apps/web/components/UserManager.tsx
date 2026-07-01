'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  TextField,
  Select,
  ListBox,
  ListBoxItem,
  Chip,
  Table,
  Modal,
  useOverlayState,
  Label,
  Input,
} from '@heroui/react';
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

const ROLE_COLORS: Record<string, 'accent' | 'warning' | 'danger' | 'success'> = {
  resident: 'accent',
  supervisor: 'accent',
  director: 'warning',
  institution_admin: 'danger',
  admin: 'success',
};

export default function UserManager({ tenantId, users, currentUserRole }: UserManagerProps) {
  const router = useRouter();
  const overlay = useOverlayState({ defaultOpen: false });

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

  async function handleInvite(onClose: () => void) {
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
    overlay.close();
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
        <div className="bg-success-50 text-success p-3 rounded-lg text-sm mb-4">{success}</div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <Button onPress={overlay.open} variant="primary">
          Invite User
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="text-default-500">No users found.</p>
      ) : (
        <Table.Root aria-label="Users table" variant="primary">
          <Table.Content>
          <Table.Header>
            <Table.Column id="name">Name</Table.Column>
            <Table.Column id="role">Role</Table.Column>
            <Table.Column id="specialty">Specialty</Table.Column>
          </Table.Header>
          <Table.Body>
            {users.map((u) => (
              <Table.Row key={u.id} id={u.id}>
                <Table.Cell>{u.full_name}</Table.Cell>
                <Table.Cell>
                  {['institution_admin', 'admin'].includes(currentUserRole) ? (
                    <Select
                      aria-label="Role"
                      selectedKey={u.role}
onSelectionChange={(value) => {
                         if (value && value !== u.role) {
                           confirmRoleChange(u.id, String(value), u.full_name);
                         }
                       }}
                    >
                       <Select.Trigger aria-label="Select role"><Select.Value /></Select.Trigger>
                      <Select.Popover>
                        <ListBox aria-label="Select role">
                          {ROLE_OPTIONS.map((opt) => (
                            <ListBoxItem key={opt.key} id={opt.key}>{opt.label}</ListBoxItem>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : (
                    <Chip variant="soft" size="sm" color={ROLE_COLORS[u.role] || 'default'}>
                      {u.role}
                    </Chip>
                  )}
                </Table.Cell>
                <Table.Cell>{u.specialty || '-'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
          </Table.Content>
        </Table.Root>
      )}

      <Modal.Root isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
        <Modal.Header>Invite User</Modal.Header>
        <Modal.Body className="gap-4">
          <TextField
            type="email"
            value={inviteEmail}
            onChange={setInviteEmail}
            isRequired
          >
            <Label>Email</Label>
            <Input placeholder="user@example.com" />
          </TextField>
          <TextField
            value={inviteName}
            onChange={setInviteName}
            isRequired
          >
            <Label>Full Name</Label>
            <Input placeholder="Full name" />
          </TextField>
          <Select
            selectedKey={inviteRole}
            onSelectionChange={(value) => {
              if (value) setInviteRole(String(value));
            }}
          >
            <Select.Trigger aria-label="Select role"><Select.Value /></Select.Trigger>
            <Select.Popover>
              <ListBox aria-label="Select role">
                {ROLE_OPTIONS.map((opt) => (
                  <ListBoxItem key={opt.key} id={opt.key}>{opt.label}</ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField
            value={inviteSpecialty}
            onChange={setInviteSpecialty}
          >
            <Label>Specialty</Label>
            <Input placeholder="e.g. Cardiology" />
          </TextField>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onPress={overlay.close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => handleInvite(overlay.close)}
            isDisabled={loading}
          >
            Send Invite
          </Button>
        </Modal.Footer>
      </Modal.Root>
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