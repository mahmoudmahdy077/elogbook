/**
 * App-wide control gate driven by the web admin.
 *
 * Maintenance mode blocks every phone session behind the tenant's message.
 * A forced update below `min_app_version` blocks the app until the user
 * updates. Both screens always offer sign-out, so a mistake in the admin
 * panel cannot strand a user without a way back.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_MAINTENANCE_MESSAGE, mobileUpdateRequired } from '@elogbook/shared';
import { clinicalTokens } from '@elogbook/shared';
import { useRemoteConfig } from '../lib/remote-config-context';
import { supabase } from '../lib/supabase';

function signOut() {
  supabase.auth.signOut().catch(() => undefined);
}

async function openUpdateLink(url: string | null) {
  const target =
    url && /^https:\/\//i.test(url)
      ? url
      : Platform.OS === 'android'
        ? 'market://details?id=com.elogbook.app'
        : 'https://elogbook-web.vercel.app';
  try {
    const supported = await Linking.canOpenURL(target);
    if (supported) await Linking.openURL(target);
  } catch {
    // The user can update from their store manually.
  }
}

function BlockingScreen({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        backgroundColor: clinicalTokens.colors.backdrop.dark,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: clinicalTokens.colors.primary.glow,
          marginBottom: 20,
        }}
      >
        <Ionicons name={icon} size={30} color={clinicalTokens.colors.primary.DEFAULT} />
      </View>
      <Text
        style={{
          fontSize: 22,
          fontWeight: '600',
          color: clinicalTokens.colors.text.primary,
          textAlign: 'center',
          marginBottom: 10,
          fontFamily: clinicalTokens.fonts.heading,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 15,
          lineHeight: 22,
          color: clinicalTokens.colors.text.muted,
          textAlign: 'center',
          marginBottom: 28,
          fontFamily: clinicalTokens.fonts.body,
        }}
      >
        {body}
      </Text>
      <TouchableOpacity
        onPress={onAction}
        accessibilityRole="button"
        style={{
          minHeight: 48,
          paddingHorizontal: 28,
          borderRadius: 24,
          backgroundColor: clinicalTokens.colors.primary.DEFAULT,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{actionLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={signOut}
        accessibilityRole="button"
        style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }}
      >
        <Text style={{ color: clinicalTokens.colors.text.muted, fontSize: 14 }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export function AppControlGate({ children }: { children: React.ReactNode }) {
  const { config, appVersion, institutionName, status, refresh } = useRemoteConfig();

  // Never flash a blocking screen before the first real answer arrives.
  if (status === 'loading') return <>{children}</>;

  if (config.maintenance_mode) {
    return (
      <BlockingScreen
        icon="construct-outline"
        title="Temporarily unavailable"
        body={
          config.maintenance_message?.trim() ||
          DEFAULT_MAINTENANCE_MESSAGE
        }
        actionLabel="Try again"
        onAction={() => {
          void refresh();
        }}
      />
    );
  }

  if (appVersion !== '0.0.0' && mobileUpdateRequired(config, appVersion)) {
    return (
      <BlockingScreen
        icon="cloud-download-outline"
        title="Update required"
        body={`${institutionName ?? 'Your organisation'} requires version ${
          config.min_app_version
        } or newer. You are on ${appVersion}. Update from the app store to continue.`}
        actionLabel="Update now"
        onAction={() => {
          void openUpdateLink(config.update_url);
        }}
      />
    );
  }

  return <>{children}</>;
}
