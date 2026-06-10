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
} from '@heroui/react';
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
];

const ROLE_COLORS: Record<string, 'primary' | 'secondary' | 'warning' | 'danger' | 'success'> = {
  resident: 'primary',
  supervisor: 'secondary',
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
          role: inviteRole,
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
    setSuccess(`Invitation sent to ${inviteEmail}`);
    resetForm();
    router.refresh();
    overlay.close();
  }

  async function handleRoleChange(userId: string, newRole: string) {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.refresh();
  }

  return (
    <div>
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}
      {success && (
        <div className="bg-success-50 text-success p-3 rounded-lg text-sm mb-4">{success}</div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <Button onPress={overlay.open} color="primary">
          Invite User
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="text-default-500">No users found.</p>
      ) : (
        <Table aria-label="Users table">
          <Table.Header>
            <Table.Column>Name</Table.Column>
            <Table.Column>Role</Table.Column>
            <Table.Column>Specialty</Table.Column>
          </Table.Header>
          <Table.Body>
            {users.map((u) => (
              <Table.Row key={u.id}>
                <Table.Cell>{u.full_name}</Table.Cell>
                <Table.Cell>
                  {['institution_admin', 'admin'].includes(currentUserRole) ? (
                    <Select
                      aria-label="Role"
                      size="sm"
                      selectedKey={u.role}
                      onSelectionChange={(value) => {
                        if (value && value !== u.role) {
                          handleRoleChange(u.id, value);
                        }
                      }}
                    >
                       <Select.Trigger aria-label="Select role"><Select.Value /></Select.Trigger>
                      <Select.Popover>
                        <ListBox aria-label="Select role">
                          {ROLE_OPTIONS.map((opt) => (
                            <ListBoxItem id={opt.key}>{opt.label}</ListBoxItem>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : (
                    <Chip variant="flat" size="sm" color={ROLE_COLORS[u.role] || 'default'}>
                      {u.role}
                    </Chip>
                  )}
                </Table.Cell>
                <Table.Cell>{u.specialty || '-'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <Modal.Root isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
        <Modal.Header>Invite User</Modal.Header>
        <Modal.Body className="gap-4">
          <TextField
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={setInviteEmail}
            isRequired
            placeholder="user@example.com"
          />
          <TextField
            label="Full Name"
            value={inviteName}
            onChange={setInviteName}
            isRequired
          />
          <Select
            label="Role"
            selectedKey={inviteRole}
            onSelectionChange={(value) => {
              if (value) setInviteRole(value);
            }}
          >
            <Select.Trigger aria-label="Select role"><Select.Value /></Select.Trigger>
            <Select.Popover>
              <ListBox aria-label="Select role">
                {ROLE_OPTIONS.map((opt) => (
                  <ListBoxItem id={opt.key}>{opt.label}</ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField
            label="Specialty"
            value={inviteSpecialty}
            onChange={setInviteSpecialty}
            placeholder="e.g. Cardiology"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="light" onPress={overlay.close}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={() => handleInvite(overlay.close)}
            isLoading={loading}
          >
            Send Invite
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </div>
  );
}
