/**
 * Tenant announcement banner (web → Admin → Mobile App → Announcement).
 * Dismissal is per device and per announcement id; an edited notice gets a
 * new id on the server and therefore shows again.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { activeAnnouncement, clinicalTokens } from '@elogbook/shared';
import { useRemoteConfig } from '../lib/remote-config-context';

const DISMISSED_KEY = 'mobile.announcements.dismissed.v1';

const SEVERITY_STYLE = {
  info: { background: 'rgba(0,122,255,0.12)', border: 'rgba(0,122,255,0.35)', icon: 'information-circle' as const },
  warning: { background: 'rgba(255,149,0,0.14)', border: 'rgba(255,149,0,0.4)', icon: 'alert-circle' as const },
  critical: { background: 'rgba(255,59,48,0.14)', border: 'rgba(255,59,48,0.4)', icon: 'warning' as const },
} as const;

export function AnnouncementBanner() {
  const { config } = useRemoteConfig();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISMISSED_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(parsed)) {
          setDismissed(parsed.filter((v): v is string => typeof v === 'string'));
        }
      } catch {
        // unreadable list — show the banner
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const announcement = useMemo(
    () => activeAnnouncement(config, Date.now(), dismissed),
    [config, dismissed],
  );

  const dismiss = useCallback(async () => {
    if (!announcement) return;
    const next = [...dismissed, announcement.id].slice(-50);
    setDismissed(next);
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // dismissal is best-effort
    }
  }, [announcement, dismissed]);

  if (!loaded || !announcement) return null;
  const style = SEVERITY_STYLE[announcement.severity];

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: style.background,
        borderColor: style.border,
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 14,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <Ionicons name={style.icon} size={20} color={clinicalTokens.colors.text.primary} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '600',
            fontSize: 15,
            color: clinicalTokens.colors.text.primary,
          }}
        >
          {announcement.title}
        </Text>
        <Text
          style={{
            fontFamily: clinicalTokens.fonts.body,
            fontSize: 13,
            lineHeight: 19,
            marginTop: 3,
            color: clinicalTokens.colors.text.secondary,
          }}
        >
          {announcement.body}
        </Text>
      </View>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityLabel="Dismiss announcement"
        accessibilityRole="button"
        hitSlop={10}
      >
        <Ionicons name="close" size={18} color={clinicalTokens.colors.text.muted} />
      </TouchableOpacity>
    </View>
  );
}

export default AnnouncementBanner;
