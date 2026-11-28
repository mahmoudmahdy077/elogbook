/**
 * Optional "update available" banner from the web admin's latest version
 * (`mobile_app_config.latest_app_version`). Forced updates are handled by
 * AppControlGate; this is the softer case where the build still works.
 * Dismissal is per version, so a newer release shows again.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  clinicalTokens,
  compareAppVersions,
  mobileUpdateRequired,
} from '@elogbook/shared';
import { useRemoteConfig } from '../lib/remote-config-context';

const DISMISSED_KEY = 'mobile.update.dismissed.v1';

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

export function UpdateAvailableBanner() {
  const { config, appVersion } = useRemoteConfig();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setDismissedVersion(await AsyncStorage.getItem(DISMISSED_KEY));
      } catch {
        // unreadable preference — show the banner
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const latest = config.latest_app_version;
  const visible =
    loaded &&
    !!latest &&
    appVersion !== '0.0.0' &&
    !mobileUpdateRequired(config, appVersion) &&
    compareAppVersions(latest, appVersion) > 0 &&
    dismissedVersion !== latest;

  const dismiss = useCallback(async () => {
    if (!latest) return;
    setDismissedVersion(latest);
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, latest);
    } catch {
      // best-effort
    }
  }, [latest]);

  if (!visible || !latest) return null;

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: 'rgba(0,122,255,0.10)',
        borderColor: 'rgba(0,122,255,0.30)',
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Ionicons name="cloud-download-outline" size={20} color={clinicalTokens.colors.primary.DEFAULT} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '600',
            fontSize: 15,
            color: clinicalTokens.colors.text.primary,
          }}
        >
          Update available
        </Text>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 13,
            lineHeight: 19,
            marginTop: 2,
            color: clinicalTokens.colors.text.secondary,
          }}
        >
          Version {latest} is available. You are on {appVersion}.
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => {
          void openUpdateLink(config.update_url);
        }}
        accessibilityRole="button"
        accessibilityLabel="Update the app"
        style={{ paddingHorizontal: 10, paddingVertical: 6 }}
      >
        <Text style={{ color: clinicalTokens.colors.primary.DEFAULT, fontWeight: '600', fontSize: 14 }}>
          Update
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityLabel="Dismiss update notice"
        accessibilityRole="button"
        hitSlop={10}
      >
        <Ionicons name="close" size={18} color={clinicalTokens.colors.text.muted} />
      </TouchableOpacity>
    </View>
  );
}

export default UpdateAvailableBanner;
