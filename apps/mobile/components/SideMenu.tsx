import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSideMenu } from '../lib/side-menu-context';
import { getFilteredMenuItems } from '../lib/role-menu-config';
import { clinicalTokens } from '@elogbook/shared';
import type { UserRole } from '@elogbook/shared';

const MENU_WIDTH = Dimensions.get('window').width * 0.75;

interface SideMenuProps {
  role: UserRole | null;
  userName?: string;
}

export default function SideMenu({ role, userName }: SideMenuProps) {
  const { isOpen, close } = useSideMenu();
  const slideAnim = useRef(new Animated.Value(MENU_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: isOpen ? 0 : MENU_WIDTH,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: isOpen ? 1 : 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen, slideAnim, overlayOpacity]);

  const items = getFilteredMenuItems(role);

  const handleNavigate = (route: string) => {
    close();
    // Short delay to let menu close animation play
    setTimeout(() => router.push(route as any), 280);
  };

  return (
    <>
      {/* Overlay */}
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          opacity: overlayOpacity,
          zIndex: 999,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={close} />
      </Animated.View>

      {/* Menu panel */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: MENU_WIDTH,
          backgroundColor: '#FFFFFF',
          transform: [{ translateX: slideAnim }],
          zIndex: 1000,
          paddingTop: 60,
          paddingHorizontal: 20,
          borderTopLeftRadius: 20,
          borderBottomLeftRadius: 20,
          shadowColor: '#000',
          shadowOffset: { width: -4, height: 0 },
          shadowOpacity: 0.15,
          shadowRadius: 20,
          elevation: 20,
        }}
      >
        {/* User info */}
        <View className="mb-6 pb-4 border-b" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
          <Text
            className="text-base"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '600',
              color: clinicalTokens.colors.text.primary,
            }}
          >
            {userName ?? 'User'}
          </Text>
          {role && (
            <Text
              className="text-xs mt-0.5"
              style={{
                fontFamily: clinicalTokens.fonts.body,
                color: clinicalTokens.colors.primary.DEFAULT,
              }}
            >
              {role.replace('_', ' ')}
            </Text>
          )}
        </View>

        {/* Menu items */}
        <ScrollView showsVerticalScrollIndicator={false}>
          {items.map((item, index) => (
            <TouchableOpacity
              key={item.key}
              className="flex-row items-center py-3.5"
              onPress={() => handleNavigate(item.route)}
              accessibilityLabel={item.label}
              accessibilityRole="button"
              style={{ opacity: 1 }}
            >
              <View
                className="w-9 h-9 rounded-lg items-center justify-center mr-3"
                style={{ backgroundColor: clinicalTokens.colors.primary.glow }}
              >
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={clinicalTokens.colors.primary.DEFAULT}
                />
              </View>
              <Text
                className="text-base"
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  fontWeight: '500',
                  color: clinicalTokens.colors.text.primary,
                }}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </>
  );
}
