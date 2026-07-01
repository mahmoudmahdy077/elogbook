import '../global.css';

import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ToastAndroid, Platform, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { clinicalTokens } from '@elogbook/shared/src/constants/design-tokens';
import { usePreventScreenCapture, onScreenshotAttempt } from '../lib/screenshot-guard';
import { useSyncInit } from '../lib/sync';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: clinicalTokens.colors.backdrop.dark, padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '600', color: clinicalTokens.colors.danger.DEFAULT, marginBottom: 8 }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 14, color: clinicalTokens.colors.text.muted, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error.message}
          </Text>
          <TouchableOpacity onPress={this.reset} style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: clinicalTokens.colors.primary.DEFAULT }}>
            <Text style={{ color: clinicalTokens.colors.primary.DEFAULT, fontSize: 14, fontWeight: '500' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

function ScreenshotAwareLayout({ children }: { children: React.ReactNode }) {
  // Block screenshots / screen recording while PHI is on-screen. The hook
  // asks the OS to suppress the framebuffer so any attempted screenshot
  // produces a blank image (iOS) or is blocked entirely (Android with
  // FLAG_SECURE).
  usePreventScreenCapture();

  useEffect(() => {
    const off = onScreenshotAttempt(() => {
      const msg = 'Screenshots are disabled to protect patient data.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.LONG);
      } else {
        Alert.alert('Screenshots blocked', msg);
      }
    });
    return () => off();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Outfit': require('../assets/fonts/Outfit-Regular.ttf'),
    'Outfit-Bold': require('../assets/fonts/Outfit-Bold.ttf'),
    'Outfit-SemiBold': require('../assets/fonts/Outfit-SemiBold.ttf'),
    'Inter': require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('../assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'GeistMono': require('../assets/fonts/GeistMono-Regular.ttf'),
    'GeistMono-Medium': require('../assets/fonts/GeistMono-Medium.ttf'),
  });

  // Initialize sync service with auth state
  useSyncInit();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ScreenshotAwareLayout>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ScreenshotAwareLayout>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}