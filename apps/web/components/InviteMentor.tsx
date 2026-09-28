'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Invitation issuance UI.
 *
 * This component used to INSERT into `tenant_invites` from the browser and then
 * fabricate a share link from `invite.id`. Both were wrong:
 *
 *   * A browser-side insert bypassed the audited, rate-limited admin endpoint
 *     and produced an invitation with no token digest, so it could be consumed
 *     by handle_new_user on nothing but an email-address match.
 *   * `invite.id` is a surrogate key, not a secret, and the redemption
 *     endpoint requires a real token, so the "link" was both leaked and broken.
 *   * "Registration Link" handed the tenant a self-service signup URL for a
 *     product that no longer permits public signup.
 *
 * Now the only thing it does is POST to /api/[tenant]/admin/invite, which mints
 * the token, stores its digest, and queues the single-use accept link. The
 * component never sees a token, so there is nothing here to leak.
 */
interface InviteMentorProps {
  tenantSlug: string;
  tenantId: string;
}

const INVITABLE_ROLES = [
  { value: 'resident', label: 'Resident' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'director', label: 'Director' },
] as const;

export default function InviteMentor({ tenantSlug }: InviteMentorProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('resident');
  const [loading, setLoading] = useState(false);
  const [bulkEmails, setBulkEmails] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [errors, setErrors] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const { show: showToast } = useToast();

  const invite = async (address: string): Promise<boolean> => {
    const res = await fetch(`/api/${tenantSlug}/admin/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, role }),
    });
    const contentType = res.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await res.json()
      : { error: 'The invitation could not be created. Please try again.' };
    if (!res.ok) {
      setErrors((prev) => [
        ...prev,
        typeof data?.error === 'string' && data.error
          ? data.error
          : 'The invitation could not be created. Please try again.',
      ]);
      return false;
    }
    return true;
  };

  const handleSingleInvite = async () => {
    setErrors([]);
    setSuccessCount(0);
    if (!email.trim()) {
      setErrors(['Email is required']);
      return;
    }
    setLoading(true);
    try {
      const created = await invite(email.trim());
      if (!created) return;
      showToast('Invitation email sent', 'success');
      setEmail('');
    } catch {
      setErrors(['The invitation could not be created. Please try again.']);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = async () => {
    setErrors([]);
    setSuccessCount(0);

    const addresses = bulkEmails
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry.includes('@'));

    if (addresses.length === 0) {
      setErrors(['No valid emails found']);
      return;
    }

    setLoading(true);
    let success = 0;
    try {
      for (const address of addresses) {
        if (await invite(address)) success += 1;
      }
    } catch {
      setErrors((prev) => [...prev, 'Some invitations could not be created.']);
    } finally {
      setLoading(false);
    }

    setSuccessCount(success);
    if (success > 0) {
      showToast(`Sent ${success} invitation email${success === 1 ? '' : 's'}`, 'success');
    }
  };

  const pendingCount = bulkEmails
    .split(/[\n,;]+/)
    .filter((entry) => entry.trim() && entry.trim().includes('@')).length;

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Invite Users</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'single' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'
            }`}
          >
            Single Invite
          </button>
          <button
            type="button"
            onClick={() => setMode('bulk')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'bulk' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'
            }`}
          >
            Bulk Import
          </button>
        </div>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Each invitation is emailed as a single-use link that expires after 72 hours. The link is
        never shown here, so it cannot be forwarded from this page.
      </p>

      {errors.length > 0 && (
        <div className="mb-4 bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger" role="alert">
          {errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </div>
      )}

      {successCount > 0 && (
        <div className="mb-4 bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success">
          Sent {successCount} invitation email{successCount === 1 ? '' : 's'}
        </div>
      )}

      {mode === 'single' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-email" className="block text-sm font-medium text-text-primary">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@hospital.org"
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="invite-role" className="block text-sm font-medium text-text-primary">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            >
              {INVITABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSingleInvite}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Creating invite...' : 'Create Invite Link'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-bulk" className="block text-sm font-medium text-text-primary">
              Email List (one per line or comma-separated)
            </label>
            <textarea
              id="invite-bulk"
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              placeholder={'resident1@hospital.org\nresident2@hospital.org'}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary h-32 resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="invite-bulk-role" className="block text-sm font-medium text-text-primary">
              Role for all users
            </label>
            <select
              id="invite-bulk-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            >
              {INVITABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleBulkImport}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Importing...' : `Import ${pendingCount} Users`}
          </button>
        </div>
      )}
    </div>
  );
}
