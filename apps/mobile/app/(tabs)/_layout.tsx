import { useState, useEffect } from 'react';
import { Tabs } from 'expo-router';
import { View, ActivityIndicator, TouchableOpacity, Text, AppState } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useSyncInit } from '../../lib/sync';
import { useAuthGuard } from '../../lib/auth-guard';
import { ScreenErrorBoundary } from '../../components/ScreenErrorBoundary';
import {
  authenticateWithBiometrics,
  isBiometricSessionValid,
  markBiometricAuthed,
} from '../../lib/biometric-gate';
import type { UserRole } from '@elogbook/shared';
import { clinicalTokens } from '@elogbook/shared';

export default function TabLayout() {
  useSyncInit();
  const { isAuthenticated, isLoading: authLoading } = useAuthGuard();
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (profile) {
        setRole(profile.role as UserRole);
      }
      setLoading(false);
    })();
  }, []);

  // Biometric gate: re-authenticate when the app comes back to the foreground
  // or on first mount. A 5-minute in-memory cache avoids prompting again for
  // short in-app navigations. The `authed` outcome (or `unavailable` on
  // devices without biometrics enrolled) is what unblocks the tabs.
  useEffect(() => {
    if (!isAuthenticated) {
      setBiometricUnlocked(false);
      return;
    }
    if (isBiometricSessionValid()) {
      setBiometricUnlocked(true);
      return;
    }
    (async () => {
      const r = await authenticateWithBiometrics('Unlock E-Logbook');
      if (r.outcome === 'authed') {
        markBiometricAuthed();
        setBiometricUnlocked(true);
      } else if (r.outcome === 'unavailable') {
        setBiometricUnlocked(true);
      } else {
        setBiometricError(r.reason ?? r.outcome);
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        // Invalidate the cached biometric session on background so a
        // subsequent foreground forces a re-prompt.
        setBiometricUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  if (authLoading || loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    if (typeof window !== 'undefined' || router.canGoBack()) {
      router.replace('/login');
    }
    return null;
  }

  if (!biometricUnlocked) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      >
        <Ionicons name="lock-closed" size={56} color={clinicalTokens.colors.primary.DEFAULT} />
        <Text
          className="text-white text-xl mt-4 text-center"
          style={{ fontFamily: clinicalTokens.fonts.heading }}
          accessibilityRole="header"
        >
          Locked
        </Text>
        <Text
          className="text-gray-500 text-sm mt-2 mb-6 text-center"
          style={{ fontFamily: clinicalTokens.fonts.body }}
        >
          {biometricError ? `Authentication required (${biometricError})` : 'Authenticate to view your cases'}
        </Text>
        <TouchableOpacity
          className="bg-teal-600 rounded-xl py-3 px-6"
          onPress={async () => {
            setBiometricError(null);
            const r = await authenticateWithBiometrics('Unlock E-Logbook');
            if (r.outcome === 'authed') {
              markBiometricAuthed();
              setBiometricUnlocked(true);
            } else if (r.outcome === 'unavailable') {
              setBiometricUnlocked(true);
            } else {
              setBiometricError(r.reason ?? r.outcome);
            }
          }}
          accessibilityLabel="Retry biometric authentication"
          accessibilityRole="button"
        >
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.heading }}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showLogCase = role === 'resident';
  const showApprovals = role === 'supervisor' || role === 'director' || role === 'admin';
  const showAIInsights = role === 'resident' || role === 'director' || role === 'admin';

  return (
    <ScreenErrorBoundary screenName="Tabs">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: clinicalTokens.colors.neutral.dark, borderTopColor: clinicalTokens.colors.neutral.dark },
          tabBarActiveTintColor: clinicalTokens.colors.primary.DEFAULT,
          tabBarInactiveTintColor: clinicalTokens.colors.text.muted,
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="log-case"
        options={{
          title: 'Log Case',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
        listeners={!showLogCase ? { tabPress: (e) => { e.preventDefault(); } } : undefined}
      />
      <Tabs.Screen
        name="my-cases"
        options={{
          title: 'My Cases',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai-insights"
        options={{
          title: 'AI Insights',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sparkles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rotations"
        options={{
          title: 'Rotations',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="case-detail"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </ScreenErrorBoundary>
  );
}