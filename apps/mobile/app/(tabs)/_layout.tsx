import { useState, useEffect } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSyncInit } from '../../lib/sync';
import { useAuthGuard, getRoleFromAuth } from '../../lib/auth-guard';
import { ScreenErrorBoundary } from '../../components/ScreenErrorBoundary';
import { clinicalTokens } from '@elogbook/shared';
import type { UserRole } from '@elogbook/shared';

function TabIcon({ name, color, size }: { name: keyof typeof Ionicons.glyphMap; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

// Elevated center button for "New Case"
function CenterButton({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: clinicalTokens.colors.primary.DEFAULT,
        marginTop: -14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: clinicalTokens.colors.primary.DEFAULT,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 10,
      }}
    >
      <Ionicons name="add" size={28} color="#FFFFFF" />
    </View>
  );
}

export default function TabLayout() {
  useSyncInit();
  const { isAuthenticated, isLoading: authLoading } = useAuthGuard();
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      const { role } = await getRoleFromAuth();
      if (role) setRole(role);
    })();
  }, [isAuthenticated]);

  return (
    <ScreenErrorBoundary screenName="Tabs">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: clinicalTokens.colors.border.DEFAULT,
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 6,
            paddingTop: 6,
          },
          tabBarActiveTintColor: clinicalTokens.colors.primary.DEFAULT,
          tabBarInactiveTintColor: clinicalTokens.colors.text.muted,
          tabBarLabelStyle: {
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 11,
            fontWeight: '500',
          },
          animation: 'fade' as const,
        }}
      >
        {/* Tab 1 — Dashboard */}
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <TabIcon name="home" color={color} size={size} />
            ),
          }}
        />

        {/* Tab 2 — New Case (center elevated) */}
        <Tabs.Screen
          name="log-case"
          listeners={({ navigation }: { navigation: any }) => ({
            tabPress: (e: any) => {
              if (role && role !== 'resident') {
                e.preventDefault();
              }
            },
          })}
          options={{
            title: 'New Case',
            tabBarIcon: ({ focused }) => <CenterButton focused={focused} />,
            tabBarLabel: () => null,
          }}
        />

        {/* Tab 3 — Profile */}
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <TabIcon name="person" color={color} size={size} />
            ),
          }}
        />

        {/* Hidden screens (side menu only) */}
        <Tabs.Screen name="my-cases" options={{ href: null }} />
        <Tabs.Screen name="approvals" options={{ href: null }} />
        <Tabs.Screen name="rotations" options={{ href: null }} />
        <Tabs.Screen name="ai-insights" options={{ href: null }} />
        <Tabs.Screen name="duty-hours" options={{ href: null }} />
        <Tabs.Screen name="evaluations" options={{ href: null }} />
        <Tabs.Screen name="milestones" options={{ href: null }} />
        <Tabs.Screen name="case-detail" options={{ href: null }} />
      </Tabs>
    </ScreenErrorBoundary>
  );
}
