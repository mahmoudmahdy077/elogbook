import { useState, useEffect } from 'react';
import { Tabs } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import type { UserRole } from '@elogbook/shared';

export default function TabLayout() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#060814' }}>
        <ActivityIndicator color="#0D9488" size="large" />
      </View>
    );
  }

  const showLogCase = role === 'resident';
  const showApprovals = role === 'supervisor' || role === 'director' || role === 'admin';
  const showAIInsights = role === 'resident' || role === 'director' || role === 'admin';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#1a1a1a' },
        tabBarActiveTintColor: '#0D9488',
        tabBarInactiveTintColor: '#666',
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
  );
}