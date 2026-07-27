import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSideMenu } from '../lib/side-menu-context';
import { clinicalTokens } from '@elogbook/shared';

interface ScreenWrapperProps {
  title: string;
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  rightAction?: ReactNode;
}

export default function ScreenWrapper({
  title,
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  rightAction,
}: ScreenWrapperProps) {
  const insets = useSafeAreaInsets();
  const { toggle } = useSideMenu();

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

  if (!scroll) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      >
        {header}
        <View className="flex-1 px-5 pb-4">{children}</View>
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
        {children}
      </ScrollView>
    </View>
  );
}
