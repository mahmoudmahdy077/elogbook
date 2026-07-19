import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { getDatabase } from '../../lib/db/database';
import { getRoleFromAuth } from '../../lib/auth-guard';
import { NativeGlassPanel as GlassPanel } from '@elogbook/shared/components/native';
import { clinicalTokens } from '@elogbook/shared';
import type { UserRole } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

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
    .split(/[_\\s]+/)
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
      // First try to read from JWT metadata (fast, no DB query)
      const { role, fullName, tenantId } = await getRoleFromAuth();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Build profile from JWT metadata with DB fallback for specialty
      const profileId = user.id;

      if (role && fullName && tenantId) {
        setProfile({
          id: profileId,
          full_name: fullName,
          role,
          specialty: null,
          tenant_id: tenantId,
        });

        // Try to get specialty from profiles table (non-critical, best-effort)
        try {
          const { data: dbProfile } = await supabase
            .from('profiles')
            .select('specialty, id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          if (dbProfile) {
            setProfile((prev) =>
              prev ? { ...prev, specialty: dbProfile.specialty, id: dbProfile.id } : prev
            );
          }
        } catch {
          // Non-critical — JWT already has basic profile data
        }

        // Load subscription data (non-critical)
        try {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('plan_id')
            .eq('id', tenantId)
            .maybeSingle();

          if (tenant?.plan_id) {
            const { data: planData } = await supabase
              .from('subscription_plans')
              .select('name, slug')
              .eq('id', tenant.plan_id)
              .maybeSingle();

            if (planData) {
              setPlan(planData as PlanData);
            }
          }

          const { data: subscription } = await supabase
            .from('subscriptions')
            .select('status')
            .eq('tenant_id', tenantId)
            .maybeSingle();

          if (subscription) {
            setSubscriptionStatus(subscription.status as string);
          }
        } catch {
          // Subscription data is non-critical
        }

        setLoading(false);
        return;
      }

      // Fallback: direct DB query (may fail due to RLS bug)
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

      const profileData = data as unknown as ProfileData;
      setProfile(profileData);

      const { data: tenant } = await supabase
        .from('tenants')
        .select('plan_id')
        .eq('id', profileData.tenant_id)
        .maybeSingle();

      if (tenant?.plan_id) {
        const { data: planData } = await supabase
          .from('subscription_plans')
          .select('name, slug')
          .eq('id', tenant.plan_id)
          .maybeSingle();

        if (planData) {
          setPlan(planData as PlanData);
        }
      }

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('tenant_id', profileData.tenant_id)
        .maybeSingle();

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
    // Clear local WatermelonDB data before signing out
    try {
      const db = getDatabase();
      const tableNames = [
        'case_entries',
        'case_templates',
        'program_goals',
        'rotations',
        'milestones',
        'evaluation_forms',
        'comments',
        'shifts',
      ];

      await db.write(async () => {
        for (const tableName of tableNames) {
          const records = await db.get(tableName).query().fetch();
          for (const record of records) {
            await record.destroyPermanently();
          }
        }
      });
    } catch (err) {
      console.error('Failed to clear local data on sign out:', err);
    }

    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  if (loadError || !profile) {
    return (
      <View className="flex-1 items-center justify-center px-4" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <Text className="text-gray-500 mb-4" style={{ fontFamily: clinicalTokens.fonts.body }}>Unable to load profile.</Text>
        <TouchableOpacity
          className="bg-primary px-6 py-2 rounded-lg"
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
    <ScreenWrapper title="Profile">
      {/* Avatar & Name */}
      <Animated.View entering={FadeIn.delay(100).springify()}>
        <View className="items-center mb-8 mt-2">
        <View className="w-20 h-20 rounded-full bg-primary items-center justify-center mb-4">
          <Text className="text-white text-3xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>{initial}</Text>
        </View>
        <Text className="text-xl" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '600', color: clinicalTokens.colors.text.primary }}>
          {profile.full_name}
        </Text>
        <Text className="mt-1" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
          {titleCase(profile.role)}
        </Text>
        {profile.specialty && (
          <Text className="mt-1" style={{ fontFamily: clinicalTokens.fonts.mono, color: clinicalTokens.colors.primary.DEFAULT }}>
            {profile.specialty}
          </Text>
        )}
      </View>
      </Animated.View>

      {/* Subscription */}
      {(plan || subscriptionStatus) && (
        <Animated.View entering={FadeInDown.delay(150).springify()}>
          <GlassPanel style={{ marginBottom: 12 }}>
          <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Subscription</Text>
          {plan && (
            <Text style={{ fontFamily: clinicalTokens.fonts.heading, color: clinicalTokens.colors.text.primary }}>{plan.name}</Text>
          )}
          {subscriptionStatus && (
            <Text
              className="text-xs mt-1"
              style={{
                fontFamily: clinicalTokens.fonts.mono,
                color:
                  subscriptionStatus === 'active'
                    ? '#34C759'
                    : subscriptionStatus === 'trialing'
                      ? '#FF9500'
                      : '#FF3B30',
              }}
            >
              {titleCase(subscriptionStatus)}
            </Text>
          )}
          <TouchableOpacity
            className="mt-3 bg-primary/10 rounded-lg py-2.5 items-center border border-primary/30"
            onPress={() => {
              Alert.alert('Coming Soon', 'Subscription management will be available in a future update.');
            }}
            accessibilityLabel="Manage subscription"
            accessibilityRole="button"
          >
            <Text className="text-primary text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>Manage Subscription</Text>
          </TouchableOpacity>
        </GlassPanel>
      </Animated.View>
      )}

      {/* Account Info */}
      <Animated.View entering={FadeInDown.delay(200).springify()}>
        <GlassPanel style={{ marginBottom: 12 }}>
        <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2" style={{ fontFamily: clinicalTokens.fonts.body }}>Account</Text>
        <View className="flex-row justify-between py-2 border-b" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
          <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>Role</Text>
          <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.mono, color: clinicalTokens.colors.text.primary }}>
            {titleCase(profile.role)}
          </Text>
        </View>
        {profile.specialty && (
          <View className="flex-row justify-between py-2 border-b" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
            <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>Specialty</Text>
            <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.mono, color: clinicalTokens.colors.text.primary }}>
              {profile.specialty}
            </Text>
          </View>
        )}
        <View className="flex-row justify-between py-2">
          <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>ID</Text>
          <Text className="text-xs" style={{ fontFamily: clinicalTokens.fonts.mono, color: clinicalTokens.colors.text.muted }}>
            {profile.id.slice(0, 8)}...
          </Text>
        </View>
      </GlassPanel>
      </Animated.View>

      {/* Sign Out */}
      <Animated.View entering={FadeInDown.delay(250).springify()}>
        <TouchableOpacity
        className="bg-[#FF3B30]/15 rounded-xl py-4 items-center border border-red-600/40 mb-4"
        onPress={handleSignOut}
        accessibilityLabel="Sign out"
        accessibilityRole="button"
      >
        <Text className="text-red-400" style={{ fontFamily: clinicalTokens.fonts.heading }}>Sign Out</Text>
      </TouchableOpacity>
      </Animated.View>
    </ScreenWrapper>
  );
}
