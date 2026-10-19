import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfilePromotionResult =
  | { ok: true }
  | { ok: false; error: string };

type ProfileState = {
  status?: string | null;
};

export async function promotePendingProfileIfNeeded(
  supabase: SupabaseClient,
): Promise<ProfilePromotionResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, error: 'Unable to verify account state. Please try again.' };
  }

  let profileData: unknown = null;
  let profileError: unknown = null;
  try {
    const profileResponse = await supabase
      .from('profiles')
      .select('status')
      .eq('user_id', userData.user.id)
      .single();
    profileData = profileResponse.data;
    profileError = profileResponse.error;
  } catch (error) {
    profileError = error;
  }
  const profile = profileData as ProfileState | null;

  if (profileError || !profile) {
    return { ok: false, error: 'Unable to verify account state. Please try again.' };
  }

  if (profile.status === 'active') {
    return { ok: true };
  }

  if (profile.status === 'pending') {
    let promotionData: unknown = null;
    let promotionError: unknown = null;
    try {
      const promotionResponse = await supabase.rpc('promote_pending_profile');
      promotionData = promotionResponse.data;
      promotionError = promotionResponse.error;
    } catch (error) {
      promotionError = error;
    }
    const promotionSucceeded = (promotionData as { success?: boolean } | null)?.success === true;
    if (promotionError || !promotionSucceeded) {
      return { ok: false, error: 'MFA verified, but account promotion failed. Please retry.' };
    }
    return { ok: true };
  }

  return { ok: false, error: 'Unable to verify account state. Please try again.' };
}
