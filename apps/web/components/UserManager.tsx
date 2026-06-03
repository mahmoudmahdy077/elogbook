'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Input,
  Select,
  SelectItem,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from '@heroui/react';
import type { Selection } from '@heroui/react';
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
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

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
    onClose();
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
        <Button onPress={onOpen} color="primary">
          Invite User
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="text-default-500">No users found.</p>
      ) : (
        <Table aria-label="Users table">
          <TableHeader>
            <TableColumn>Name</TableColumn>
            <TableColumn>Role</TableColumn>
            <TableColumn>Specialty</TableColumn>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.full_name}</TableCell>
                <TableCell>
                  {['institution_admin', 'admin'].includes(currentUserRole) ? (
                    <Select
                      aria-label="Role"
                      size="sm"
                      selectedKeys={new Set([u.role])}
                      onSelectionChange={(keys: Selection) => {
                        const value = Array.from(keys)[0] as string;
                        if (value && value !== u.role) {
                          handleRoleChange(u.id, value);
                        }
                      }}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Chip variant="flat" size="sm" color={ROLE_COLORS[u.role] || 'default'}>
                      {u.role}
                    </Chip>
                  )}
                </TableCell>
                <TableCell>{u.specialty || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Invite User</ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label="Email"
                  type="email"
                  value={inviteEmail}
                  onValueChange={setInviteEmail}
                  isRequired
                  placeholder="user@example.com"
                />
                <Input
                  label="Full Name"
                  value={inviteName}
                  onValueChange={setInviteName}
                  isRequired
                />
                <Select
                  label="Role"
                  selectedKeys={new Set([inviteRole])}
                  onSelectionChange={(keys: Selection) => {
                    const value = Array.from(keys)[0] as string;
                    if (value) setInviteRole(value);
                  }}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.key}>{opt.label}</SelectItem>
                  ))}
                </Select>
                <Input
                  label="Specialty"
                  value={inviteSpecialty}
                  onValueChange={setInviteSpecialty}
                  placeholder="e.g. Cardiology"
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  onPress={() => handleInvite(onClose)}
                  isLoading={loading}
                >
                  Send Invite
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
