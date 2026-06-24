import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import GlassPanel from '../../components/GlassPanel';
import { clinicalTokens } from '@elogbook/shared';
import type { UserRole } from '@elogbook/shared';

interface ProfileData {
  id: string;
  full_name: string;
  role: UserRole;
  specialty: string | null;
  tenant_id: string;
}

interface PlanData {
  name: string;
  slug: string;
}

function titleCase(str: string): string {
  return str
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, specialty, tenant_id')
        .eq('user_id', user.id)
        .single();

      if (error || !data) {
        setLoadError(true);
        setLoading(false);
        return;
      }

      const profileData = data as ProfileData;
      setProfile(profileData);

      const { data: tenant } = await supabase
        .from('tenants')
        .select('plan_id')
        .eq('id', profileData.tenant_id)
        .single();

      if (tenant?.plan_id) {
        const { data: planData } = await supabase
          .from('subscription_plans')
          .select('name, slug')
          .eq('id', tenant.plan_id)
          .single();

        if (planData) {
          setPlan(planData as PlanData);
        }
      }

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('tenant_id', profileData.tenant_id)
        .single();

      if (subscription) {
        setSubscriptionStatus(subscription.status as string);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color="#0D9488" size="large" />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <Text className="text-slate-400 mb-4" style={{ fontFamily: clinicalTokens.fonts.body }}>Unable to load profile.</Text>
        <TouchableOpacity
          className="bg-teal-600 px-6 py-2 rounded-lg"
          onPress={loadProfile}
          accessibilityLabel="Retry loading profile"
          accessibilityRole="button"
        >
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const initial = profile.full_name.charAt(0).toUpperCase();

  return (
    <ScrollView className="flex-1 px-4 pt-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="items-center mb-8 mt-4">
        <View className="w-20 h-20 rounded-full bg-teal-600 items-center justify-center mb-4">
          <Text className="text-white text-3xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>{initial}</Text>
        </View>
        <Text className="text-white text-xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>{profile.full_name}</Text>
        <Text className="text-slate-400 mt-1" style={{ fontFamily: clinicalTokens.fonts.body }}>{titleCase(profile.role)}</Text>
        {profile.specialty && (
          <Text className="text-teal-400 mt-1" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {profile.specialty}
          </Text>
        )}
      </View>

      {(plan || subscriptionStatus) && (
        <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Subscription</Text>
          {plan && (
            <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>{plan.name}</Text>
          )}
          {subscriptionStatus && (
            <Text
              className={`text-xs mt-1 ${
                subscriptionStatus === 'active'
                  ? 'text-emerald-400'
                  : subscriptionStatus === 'trialing'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
              style={{ fontFamily: clinicalTokens.fonts.mono }}
            >
              {titleCase(subscriptionStatus)}
            </Text>
          )}
          <TouchableOpacity
            className="mt-3 bg-indigo-600/20 rounded-lg py-2.5 items-center border border-indigo-500/40"
            onPress={() => {
              Alert.alert('Coming Soon', 'Subscription management will be available in a future update.');
            }}
            accessibilityLabel="Manage subscription"
            accessibilityRole="button"
          >
            <Text className="text-indigo-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>Manage Subscription</Text>
          </TouchableOpacity>
        </GlassPanel>
      )}

      <GlassPanel style={{ marginBottom: 12 }}>
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Account</Text>
        <View className="flex-row justify-between py-2 border-b border-slate-700/30">
          <Text className="text-slate-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>Role</Text>
          <Text className="text-white text-sm" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {titleCase(profile.role)}
          </Text>
        </View>
        {profile.specialty && (
          <View className="flex-row justify-between py-2 border-b border-slate-700/30">
            <Text className="text-slate-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>Specialty</Text>
            <Text className="text-white text-sm" style={{ fontFamily: clinicalTokens.fonts.mono }}>
              {profile.specialty}
            </Text>
          </View>
        )}
        <View className="flex-row justify-between py-2">
          <Text className="text-slate-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>ID</Text>
          <Text className="text-slate-500 text-xs" style={{ fontFamily: clinicalTokens.fonts.mono }}>
            {profile.id.slice(0, 8)}...
          </Text>
        </View>
      </GlassPanel>

      <TouchableOpacity
        className="bg-red-600/20 rounded-xl py-4 items-center border border-red-600/40 mb-4"
        onPress={handleSignOut}
        accessibilityLabel="Sign out"
        accessibilityRole="button"
      >
        <Text className="text-red-400" style={{ fontFamily: clinicalTokens.fonts.heading }}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}