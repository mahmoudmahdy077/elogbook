import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSideMenu } from '../lib/side-menu-context';
import { clinicalTokens, isMobileFeatureEnabled, type MobileFeatureKey } from '@elogbook/shared';
import { useRemoteConfig } from '../lib/remote-config-context';

interface ScreenWrapperProps {
  title: string;
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  rightAction?: ReactNode;
  /** Web-controlled module key; a disabled module shows a notice instead. */
  featureKey?: MobileFeatureKey;
}

export default function ScreenWrapper({
  title,
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  rightAction,
  featureKey,
}: ScreenWrapperProps) {
  const insets = useSafeAreaInsets();
  const { toggle } = useSideMenu();
  const { config } = useRemoteConfig();
  const moduleDisabled = featureKey ? !isMobileFeatureEnabled(config, featureKey) : false;

  const header = (
    <View
      className="flex-row items-center justify-between px-5 pb-2"
      style={{
        paddingTop: insets.top + 8,
        backgroundColor: clinicalTokens.colors.backdrop.dark,
      }}
    >
      <Text
        className="text-[28px] tracking-tight"
        style={{
          fontFamily: clinicalTokens.fonts.heading,
          fontWeight: '700',
          color: clinicalTokens.colors.text.primary,
        }}
      >
        {title}
      </Text>
      <View className="flex-row items-center gap-2">
        {rightAction}
        <TouchableOpacity
          onPress={toggle}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: clinicalTokens.colors.neutral.light }}
          accessibilityLabel="Open menu"
          accessibilityRole="button"
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={22}
            color={clinicalTokens.colors.primary.DEFAULT}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  const content = moduleDisabled ? (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        paddingVertical: 40,
      }}
    >
      <Ionicons name="lock-closed-outline" size={32} color={clinicalTokens.colors.text.muted} />
      <Text
        style={{
          marginTop: 12,
          textAlign: 'center',
          fontFamily: clinicalTokens.fonts.heading,
          fontSize: 17,
          color: clinicalTokens.colors.text.primary,
        }}
      >
        Module turned off
      </Text>
      <Text
        style={{
          marginTop: 6,
          textAlign: 'center',
          fontFamily: clinicalTokens.fonts.body,
          fontSize: 14,
          lineHeight: 20,
          color: clinicalTokens.colors.text.muted,
        }}
      >
        Your organisation disabled this module in the app settings. Contact your administrator if
        you need it.
      </Text>
    </View>
  ) : (
    children
  );

  if (!scroll) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      >
        {header}
        <View className="flex-1 px-5 pb-4">{content}</View>
      </View>
    );
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
    >
      {header}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={clinicalTokens.colors.primary.DEFAULT}
              colors={[clinicalTokens.colors.primary.DEFAULT]}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    </View>
  );
}
