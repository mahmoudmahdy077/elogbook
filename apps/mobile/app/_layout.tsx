import '../global.css';

import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ToastAndroid,
  Platform,
  Alert,
  Linking,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { clinicalTokens } from '@elogbook/shared';
import { usePreventScreenCapture, onScreenshotAttempt } from '../lib/screenshot-guard';
import { useSyncInit } from '../lib/sync';
import { parseDeepLink, navigateToDeepLink } from '../lib/linking';
import { useNotificationNavigation } from '../hooks/useNotificationNavigation';
import { useAuthGuard } from '../lib/auth-guard';
import {
  getEffectiveSkipWindow,
  clearBiometricAuthCache,
} from '../lib/biometric-auth';
import { BiometricGate } from '../components/BiometricGate';
import { initDatabase } from '../lib/db/database';
import { Sentry } from '../lib/sentry';

// Font asset imports — loaded statically instead of using require()
import OutfitRegular from '../assets/fonts/Outfit-Regular.ttf';
import OutfitBold from '../assets/fonts/Outfit-Bold.ttf';
import OutfitSemiBold from '../assets/fonts/Outfit-SemiBold.ttf';
import InterRegular from '../assets/fonts/Inter-Regular.ttf';
import InterMedium from '../assets/fonts/Inter-Medium.ttf';
import InterSemiBold from '../assets/fonts/Inter-SemiBold.ttf';
import GeistMonoRegular from '../assets/fonts/GeistMono-Regular.ttf';
import GeistMonoMedium from '../assets/fonts/GeistMono-Medium.ttf';

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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack ?? '' },
    });
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
            An unexpected error occurred. Please try again.
          </Text>
          <TouchableOpacity onPress={this.reset} accessibilityLabel="Try again" accessibilityRole="button" style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: clinicalTokens.colors.primary.DEFAULT }}>
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
  useFonts({
    'Outfit': OutfitRegular,
    'Outfit-Bold': OutfitBold,
    'Outfit-SemiBold': OutfitSemiBold,
    'Inter': InterRegular,
    'Inter-Medium': InterMedium,
    'Inter-SemiBold': InterSemiBold,
    'GeistMono': GeistMonoRegular,
    'GeistMono-Medium': GeistMonoMedium,
  });

  // ── Auth state ────────────────────────────────────────────────────────────
  const { isAuthenticated, isLoading: authLoading } = useAuthGuard();
  const router = useRouter();

  // ── Biometric gate ─────────────────────────────────────────────────────────
  const [showBiometricGate, setShowBiometricGate] = useState(false);
  const lastBackgroundTime = useRef<number | null>(null);
  const skipWindowRef = useRef(30);

  // Load the effective skip window once on mount
  useEffect(() => {
    (async () => {
      skipWindowRef.current = await getEffectiveSkipWindow();
    })();
  }, []);

  // AppState listener: detect foreground transitions and trigger biometric gate
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lastBackgroundTime.current = Date.now();
      } else if (nextState === 'active') {
        // App came to foreground — check if gate is needed
        const bgTime = lastBackgroundTime.current;
        lastBackgroundTime.current = null;

        if (bgTime !== null && isAuthenticated) {
          const elapsed = (Date.now() - bgTime) / 1000;
          if (elapsed >= skipWindowRef.current) {
            // Clear the in-memory session cache so the gate re-prompts
            clearBiometricAuthCache();
            setShowBiometricGate(true);
          }
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [isAuthenticated]);

  // When auth state resolves to unauthenticated, hide the gate
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setShowBiometricGate(false);
    }
  }, [authLoading, isAuthenticated]);

  // ── Gate callbacks ─────────────────────────────────────────────────────────
  const handleBiometricAuthed = useCallback(() => {
    setShowBiometricGate(false);
  }, []);

  const handleBiometricFallback = useCallback(() => {
    setShowBiometricGate(false);
    // Navigate to login screen for full passcode auth
    router.replace('/login');
  }, [router]);

  // Initialize local database for offline storage
  useEffect(() => { initDatabase().catch(console.error); }, []);

  // Initialize sync service with auth state
  useSyncInit();

  // ── Deep linking ────────────────────────────────────────────────────────
  // Listen for incoming URLs while the app is already running (e.g. a user
  // taps a universal link or custom-scheme link from another app).
  useEffect(() => {
    const handler = ({ url }: { url: string }) => {
      const route = parseDeepLink(url);
      if (route) navigateToDeepLink(route);
    };

    const subscription = Linking.addEventListener('url', handler);
    return () => subscription.remove();
  }, []);

  // ── Notification navigation ─────────────────────────────────────────────
  // React hook that listens for notification taps and cold-start
  // notifications, routing to the correct screen based on the payload.
  useNotificationNavigation();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ScreenshotAwareLayout>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
          </Stack>
          {/* Biometric re-auth gate overlays the entire app */}
          {!authLoading && (
            <BiometricGate
              visible={showBiometricGate}
              onAuthenticated={handleBiometricAuthed}
              onFallbackToPasscode={handleBiometricFallback}
            />
          )}
        </ScreenshotAwareLayout>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}