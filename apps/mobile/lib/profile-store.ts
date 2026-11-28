/**
 * Own-profile store — the approved adapter for `profiles` writes from mobile.
 *
 * The web onboarding page updates full_name/specialty and marks onboarding
 * complete; the app previously had no editor. RLS restricts the update to the
 * caller's own row; role and tenant stay untouched here.
 */

import { supabase } from './supabase';

export interface OwnProfile {
  id: string;
  tenant_id: string;
  role: string;
  full_name: string | null;
  specialty: string | null;
  onboarding_completed: boolean | null;
}

export async function fetchOwnProfile(): Promise<{
  profile: OwnProfile | null;
  error: string | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { profile: null, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, full_name, specialty, onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { profile: null, error: error.message };
  return { profile: (data as OwnProfile | null) ?? null, error: null };
}

export async function updateOwnProfile(input: {
  fullName: string;
  specialty: string;
  completeOnboarding?: boolean;
}): Promise<{ ok: boolean; error: string | null }> {
  const { profile, error: readError } = await fetchOwnProfile();
  if (readError || !profile) return { ok: false, error: readError ?? 'Profile not found' };

  const fullName = input.fullName.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, error: 'Enter your full name (2–120 characters).' };
  }
  const specialty = input.specialty.trim().slice(0, 100);

  const patch: Record<string, unknown> = {
    full_name: fullName,
    specialty: specialty || null,
  };
  if (input.completeOnboarding) patch.onboarding_completed = true;

  const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id);
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}
