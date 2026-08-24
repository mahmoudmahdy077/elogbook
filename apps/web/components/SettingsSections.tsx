'use client';

import { useState } from 'react';
import ProfileEditForm from '@/components/ProfileEditForm';
import PasswordChangeForm from '@/components/PasswordChangeForm';

interface Profile {
  id: string;
  full_name: string;
  specialty: string | null;
  role: string;
}

interface SettingsSectionsProps {
  profile: Profile;
  email: string;
  aal: string;
}

export default function SettingsSections({ profile, email, aal }: SettingsSectionsProps) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(profile);

  const handleProfileSaved = (updated: { full_name: string; specialty: string | null }) => {
    setCurrentProfile((prev) => ({ ...prev, ...updated }));
    setEditingProfile(false);
  };

  return (
    <>
      <div className="panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-heading font-semibold">Profile</h2>
          {!editingProfile && (
            <button
              type="button"
              onClick={() => setEditingProfile(true)}
              className="px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-xs font-medium hover:bg-neutral transition-colors"
            >
              Edit
            </button>
          )}
        </div>
        {editingProfile ? (
          <ProfileEditForm
            profileId={currentProfile.id}
            initialFullName={currentProfile.full_name}
            initialSpecialty={currentProfile.specialty}
            onSaved={handleProfileSaved}
            onCancel={() => setEditingProfile(false)}
          />
        ) : (
          <dl className="space-y-3">
            <div className="flex justify-between"><dt className="text-text-muted">Name</dt><dd>{currentProfile.full_name}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Role</dt><dd className="capitalize">{currentProfile.role}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Specialty</dt><dd>{currentProfile.specialty || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-text-muted">Email</dt><dd>{email}</dd></div>
          </dl>
        )}
      </div>

      <div className="panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-heading font-semibold">Security</h2>
        </div>
        {changingPassword ? (
          <PasswordChangeForm
            onSaved={() => setChangingPassword(false)}
            onCancel={() => setChangingPassword(false)}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Multi-factor authentication</p>
                <p className="text-xs text-text-muted">
                  {aal === 'aal2' ? 'Enabled' : 'Not enabled — required for directors and admins'}
                </p>
              </div>
              <a href="/mfa/enroll" className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors">
                {aal === 'aal2' ? 'Manage' : 'Set up'}
              </a>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Password</p>
                <p className="text-xs text-text-muted">Update your account password</p>
              </div>
              <button
                type="button"
                onClick={() => setChangingPassword(true)}
                className="px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-xs font-medium hover:bg-neutral transition-colors"
              >
                Change Password
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
