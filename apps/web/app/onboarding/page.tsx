'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Role = 'resident' | 'supervisor' | 'director';

interface Profile {
  id: string;
  tenant_id: string;
  role: Role;
  full_name: string | null;
  specialty: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const { data: p } = await supabase
        .from('profiles')
        .select('id, tenant_id, role, full_name, specialty, onboarding_completed')
        .eq('user_id', user.id)
        .single();

      if (p?.onboarding_completed) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('slug')
          .eq('id', p.tenant_id)
          .maybeSingle();
        // `.single()` threw a TypeError here when the tenant row was absent.
        router.replace(tenant?.slug ? `/${tenant.slug}/dashboard` : '/login');
        return;
      }
      setProfile(p as Profile);
    };
    loadProfile();
  }, [router]);

  const specialties = ['Surgery', 'Internal Medicine', 'Pediatrics', 'Emergency', 'Radiology', 'Cardiology', 'Neurology', 'Orthopedics', 'Psychiatry'];

  const completeOnboarding = async () => {
    if (!profile) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      // Role is assigned by the tenant admin / invite. Writing it here tripped
      // the authorize_role_change trigger for everyone who picked supervisor or
      // director, and would be a self-escalation path otherwise.
      .update({ full_name: fullName, specialty, onboarding_completed: true })
      .eq('id', profile.id);

    if (error) {
      setError(error.message);
    } else {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('slug')
        .eq('id', profile.tenant_id)
        .maybeSingle();
      if (tenant?.slug) router.replace(`/${tenant.slug}/dashboard`);
      else setError('Your institution could not be found. Contact your administrator.');
    }
    setLoading(false);
  };

  if (!profile) return <div className="flex items-center justify-center min-h-screen"><p>Loading...</p></div>;

  return (
    <div id="main-content" className="flex items-center justify-center min-h-screen bg-backdrop">
      <div className="panel p-8 max-w-md w-full mx-4">
        <h1 className="text-2xl font-bold mb-6">Welcome to E-Logbook</h1>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your account</h2>
            <p className="text-sm text-text-muted">
              You are joining as <strong className="text-text-primary capitalize">{profile.role.replace('_', ' ')}</strong>.
              Your program administrator sets roles — contact them if this is wrong.
            </p>
            <button
              onClick={() => setStep(2)}
              className="w-full min-h-[44px] rounded-lg bg-primary px-4 py-2 text-text-on-primary"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your Profile</h2>
            <p className="text-sm text-text-muted">Enter your details.</p>
            <div>
              <label htmlFor="full-name" className="block text-xs mb-1">Full Name</label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div>
              <label htmlFor="specialty" className="block text-xs mb-1">Specialty</label>
              <select
                id="specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
              >
                <option value="">Select specialty</option>
                {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-border hover:bg-surface-raised">Back</button>
              <button
                onClick={completeOnboarding}
                disabled={loading || !fullName}
                className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Complete Setup'}
              </button>
            </div>
            {error && <p className="text-fg-danger text-sm mt-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}