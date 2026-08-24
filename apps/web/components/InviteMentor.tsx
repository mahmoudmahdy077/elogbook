'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';

interface InviteMentorProps {
  tenantSlug: string;
  tenantId: string;
}

export default function InviteMentor({ tenantSlug, tenantId }: InviteMentorProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('resident');
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [errors, setErrors] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const { show: showToast } = useToast();
  const supabase = createClient();

  const handleSingleInvite = async () => {
    setErrors([]);
    if (!email) {
      setErrors(['Email is required']);
      return;
    }

    setLoading(true);
    try {
      const { data: invite, error: inviteError } = await supabase
        .from('tenant_invites')
        .insert({
          tenant_id: tenantId,
          email,
          invited_by: (await supabase.auth.getUser()).data.user?.id,
          role,
          status: 'pending',
        })
        .select()
        .single();

      if (inviteError) {
        setErrors([inviteError.message]);
        return;
      }

      const link = `${window.location.origin}/signup?invite=${invite.id}`;
      setInviteLink(link);
      showToast('Invite created successfully', 'success');
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Failed to create invite']);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = async () => {
    setErrors([]);
    setSuccessCount(0);
    
    const emails = bulkEmails
      .split(/[\n,;]+/)
      .map(e => e.trim())
      .filter(e => e && e.includes('@'));

    if (emails.length === 0) {
      setErrors(['No valid emails found']);
      return;
    }

    setLoading(true);
    let success = 0;
    let failed = 0;

    for (const emailAddr of emails) {
      try {
        const { error } = await supabase
          .from('tenant_invites')
          .insert({
            tenant_id: tenantId,
            email: emailAddr,
            invited_by: (await supabase.auth.getUser()).data.user?.id,
            role,
            status: 'pending',
          });

        if (!error) success++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setSuccessCount(success);
    setLoading(false);
    
    if (success > 0) {
      showToast(`Successfully invited ${success} users`, 'success');
    }
    if (failed > 0) {
      setErrors([`${failed} emails failed to send`]);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    showToast('Invite link copied to clipboard', 'success');
  };

  const generateRegLink = () => {
    const link = `${window.location.origin}/signup?tenant=${tenantSlug}`;
    setInviteLink(link);
  };

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Invite Users</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'single' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'
            }`}
          >
            Single Invite
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'bulk' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'
            }`}
          >
            Bulk Import
          </button>
          <button
            onClick={generateRegLink}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface text-text-secondary border border-border hover:bg-neutral-dark transition-colors"
          >
            Registration Link
          </button>
        </div>
      </div>

      {inviteLink && (
        <div className="mb-4 bg-success/10 border border-success/30 rounded-lg p-4">
          <p className="text-sm text-success font-medium mb-2">
            {mode === 'single' ? 'Invite created!' : 'Registration link generated!'}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inviteLink}
              readOnly
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            />
            <button
              onClick={copyLink}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Copy
            </button>
          </div>
          <button
            onClick={() => { setInviteLink(''); setEmail(''); setBulkEmails(''); }}
            className="mt-2 text-sm text-primary hover:opacity-80"
          >
            Create another
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {successCount > 0 && (
        <div className="mb-4 bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success">
          Successfully invited {successCount} users
        </div>
      )}

      {mode === 'single' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-primary">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@hospital.org"
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-primary">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            >
              <option value="resident">Resident</option>
              <option value="supervisor">Supervisor</option>
              <option value="director">Director</option>
              <option value="institution_admin">Institution Admin</option>
            </select>
          </div>

          <button
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
            <label className="block text-sm font-medium text-text-primary">
              Email List (one per line or comma-separated)
            </label>
            <textarea
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              placeholder={`resident1@hospital.org\nresident2@hospital.org\nresident3@hospital.org`}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary h-32 resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-primary">Role for all users</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary"
            >
              <option value="resident">Resident</option>
              <option value="supervisor">Supervisor</option>
              <option value="director">Director</option>
              <option value="institution_admin">Institution Admin</option>
            </select>
          </div>

          <button
            onClick={handleBulkImport}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Importing...' : `Import ${bulkEmails.split(/[\n,;]+/).filter(e => e.trim() && e.includes('@')).length} Users`}
          </button>
        </div>
      )}
    </div>
  );
}
