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
  const supabase = createClient();
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
        const { data: { slug } } = await supabase.from('tenants').select('slug').eq('id', p.tenant_id).single();
        router.replace(`/${slug}/dashboard`);
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
      .update({ full_name: fullName, specialty, onboarding_completed: true })
      .eq('id', profile.id);

    if (error) setError(error.message);
    else {
      const { data: { slug } } = await supabase.from('tenants').select('slug').eq('id', profile.tenant_id).single();
      router.replace(`/${slug}/dashboard`);
    }
    setLoading(false);
  };

  if (!profile) return <div className="flex items-center justify-center min-h-screen"><p>Loading...</p></div>;

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="panel p-8 max-w-md w-full mx-4">
        <h1 className="text-2xl font-bold mb-6">Welcome to E-Logbook</h1>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your Role</h2>
            <p className="text-sm text-neutral-light/60">Select your role in the program.</p>
            <div className="grid gap-2">
              {(['resident', 'supervisor', 'director'] as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => { setProfile({ ...profile, role: r }); setStep(2); }}
                  className={`p-3 rounded-lg border text-left transition-colors ${profile?.role === r ? 'border-primary bg-primary/10' : 'border-neutral-dark hover:bg-neutral-dark/50'}`}
                >
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your Profile</h2>
            <p className="text-sm text-neutral-light/60">Enter your details.</p>
            <div>
              <label className="block text-xs mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div>
              <label className="block text-xs mb-1">Specialty</label>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
              >
                <option value="">Select specialty</option>
                {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-border hover:bg-neutral-dark/50">Back</button>
              <button
                onClick={completeOnboarding}
                disabled={loading || !fullName}
                className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Complete Setup'}
              </button>
            </div>
            {error && <p className="text-danger text-sm mt-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}