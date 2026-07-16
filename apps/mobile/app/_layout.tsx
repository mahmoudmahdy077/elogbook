import './global.css';

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
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import { usePreventScreenCapture, onScreenshotAttempt } from './lib/screenshot-guard';
import { useSyncInit } from './lib/sync';
import { parseDeepLink, navigateToDeepLink } from './lib/linking';
import { useNotificationNavigation } from './hooks/useNotificationNavigation';
import { useAuthGuard } from './lib/auth-guard';
import {
  getEffectiveSkipWindow,
  clearBiometricAuthCache,
} from './lib/biometric-auth';
import { BiometricGate } from './components/BiometricGate';
import { supabase } from './lib/supabase';
import { initDatabase } from './lib/db/database';
import { Sentry } from './lib/sentry';

// Font assets
import OutfitRegular from './assets/fonts/Outfit-Regular.ttf';
import OutfitBold from './assets/fonts/Outfit-Bold.ttf';
import OutfitSemiBold from './assets/fonts/Outfit-SemiBold.ttf';
import InterRegular from './assets/fonts/Inter-Regular.ttf';
import InterMedium from './assets/fonts/Inter-Medium.ttf';
import InterSemiBold from './assets/fonts/Inter-SemiBold.ttf';
import GeistMonoRegular from './assets/fonts/GeistMono-Regular.ttf';
import GeistMonoMedium from './assets/fonts/GeistMono-Medium.ttf';

// ── Error Boundary ────────────────────────────────────────────────────────

interface ErrorBoundaryProps { children: React.ReactNode; }
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack ?? '' } });
  }
  reset = () => this.setState({ hasError: false, error: null });
  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: clinicalTokens.colors.backdrop.dark, paddingHorizontal: 24 }}>
          <Ionicons name="warning" size={48} color={clinicalTokens.colors.danger.DEFAULT} />
          <Text style={{ fontSize: 20, fontWeight: '600', color: clinicalTokens.colors.text.primary, marginTop: 16, marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 14, color: clinicalTokens.colors.text.muted, textAlign: 'center', marginBottom: 24 }}>An unexpected error occurred. Please try again.</Text>
          <TouchableOpacity onPress={this.reset} style={{ paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: clinicalTokens.colors.primary.DEFAULT }}>
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ── Screenshot Guard ──────────────────────────────────────────────────────

function ScreenshotAwareLayout({ children }: { children: React.ReactNode }) {
  usePreventScreenCapture();
  useEffect(() => {
    const off = onScreenshotAttempt(() => {
      const msg = 'Screenshots are disabled to protect patient data.';
      Platform.OS === 'android'
        ? ToastAndroid.show(msg, ToastAndroid.LONG)
        : Alert.alert('Screenshots blocked', msg);
    });
    return () => off();
  }, []);
  return <>{children}</>;
}

// ── Root Layout ───────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Outfit': OutfitRegular,
    'Outfit-Bold': OutfitBold,
    'Outfit-SemiBold': OutfitSemiBold,
    'Inter': InterRegular,
    'Inter-Medium': InterMedium,
    'Inter-SemiBold': InterSemiBold,
    'GeistMono': GeistMonoRegular,
    'GeistMono-Medium': GeistMonoMedium,
  });

  const { isAuthenticated, isLoading: authLoading } = useAuthGuard();
  const router = useRouter();

  // ── Biometric Gate ──────────────────────────────────────────────
  const [showBiometricGate, setShowBiometricGate] = useState(false);
  const lastBackgroundTime = useRef<number | null>(null);
  const skipWindowRef = useRef(30);

  useEffect(() => {
    (async () => { skipWindowRef.current = await getEffectiveSkipWindow(); })();
  }, []);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lastBackgroundTime.current = Date.now();
      } else if (nextState === 'active') {
        const bgTime = lastBackgroundTime.current;
        lastBackgroundTime.current = null;
        if (bgTime !== null && isAuthenticated) {
          const elapsed = (Date.now() - bgTime) / 1000;
          if (elapsed >= skipWindowRef.current) {
            clearBiometricAuthCache();
            setShowBiometricGate(true);
          }
        }
      }
    };
    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) setShowBiometricGate(false);
  }, [authLoading, isAuthenticated]);

  const handleBiometricAuthed = useCallback(() => setShowBiometricGate(false), []);
  const handleBiometricFallback = useCallback(async () => {
    setShowBiometricGate(false);
    try { await supabase.auth.signOut(); } catch { /* best-effort */ }
    router.replace('/login');
  }, [router]);

  // ── Init ────────────────────────────────────────────────────────
  useEffect(() => { initDatabase().catch(console.error); }, []);
  useSyncInit();
  useNotificationNavigation();

  useEffect(() => {
    const handler = ({ url }: { url: string }) => {
      const route = parseDeepLink(url);
      if (route) navigateToDeepLink(route);
    };
    const subscription = Linking.addEventListener('url', handler);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ScreenshotAwareLayout>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              animationDuration: 200,
            }}
          >
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ScreenshotAwareLayout>

        {!authLoading && (
          <BiometricGate
            visible={showBiometricGate}
            onAuthenticated={handleBiometricAuthed}
            onFallbackToPasscode={handleBiometricFallback}
          />
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
