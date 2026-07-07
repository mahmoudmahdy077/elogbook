// Full-screen biometric auth gate — Apple Health design language.
//
// Renders an overlay when the app resumes from background:
// - Frosted-glass backdrop with a lock icon and biometric badge
// - Auto-triggers the platform biometric prompt on mount
// - "Use Passcode" fallback button after max attempts (3)
// - Shows Face ID / Touch ID / generic lock icon based on device type
//
// Apple Health design tokens come from @elogbook/shared (clinicalTokens).

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clinicalTokens } from '@elogbook/shared';
import {
  getBiometricType,
  authenticateBiometric,
} from '../lib/biometric-auth';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const FADE_DURATION = 350;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BiometricGateProps {
  /** Called when the user successfully authenticates via biometrics. */
  onAuthenticated: () => void;
  /**
   * Called when the user taps "Use Passcode".
   * Typically this navigates to the login screen for full passcode auth.
   */
  onFallbackToPasscode: () => void;
  /** Visible when the gate should be rendered. */
  visible: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BiometricGate({
  onAuthenticated,
  onFallbackToPasscode,
  visible,
}: BiometricGateProps) {
  const [biometricType, setBiometricType] = useState<'face' | 'fingerprint' | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isHidden, setIsHidden] = useState(!visible);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const verifyingRef = useRef(false);
  const mountedRef = useRef(true);

  // ── Manage hidden state based on animation ─────────────────────────────────
  useEffect(() => {
    if (visible) {
      setIsHidden(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }).start(() => {
        if (mountedRef.current) setIsHidden(true);
      });
    }
  }, [visible, fadeAnim]);

  // ── Detect biometric type on mount ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const bt = await getBiometricType();
      if (!mountedRef.current) return;
      if (bt === 'face' || bt === 'fingerprint') {
        setBiometricType(bt);
      }
    })();
    return () => { mountedRef.current = false; };
  }, []);

  // ── Auto-trigger biometric prompt on mount ──────────────────────────────────
  const triggerBiometric = useCallback(async () => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setIsVerifying(true);
    setStatusMessage(null);

    const promptMessage =
      biometricType === 'face'
        ? 'Scan your Face ID to continue'
        : 'Use your fingerprint to continue';

    const success = await authenticateBiometric(promptMessage);

    if (!mountedRef.current) return;
    verifyingRef.current = false;
    setIsVerifying(false);

    if (success) {
      setAttempts(0);
      setStatusMessage(null);
      onAuthenticated();
    } else {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        setStatusMessage('Too many attempts. Use your passcode.');
      } else {
        setStatusMessage('Authentication failed. Try again.');
      }
    }
  }, [biometricType, attempts, onAuthenticated]);

  // Auto-trigger when the gate becomes visible
  useEffect(() => {
    if (visible && attempts < MAX_ATTEMPTS) {
      // Small delay so the fade-in is smooth before the prompt appears
      const timer = setTimeout(() => {
        if (mountedRef.current) triggerBiometric();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [visible]); // only on visibility change, not on re-renders

  // ── Accessibility ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility('Biometric authentication required');
    }
  }, [visible]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const handleFallback = useCallback(() => {
    setAttempts(0);
    setStatusMessage(null);
    onFallbackToPasscode();
  }, [onFallbackToPasscode]);

  // ── Icons ───────────────────────────────────────────────────────────────────

  const lockIcon = (
    <View style={styles.iconRing}>
      <Ionicons
        name="lock-closed"
        size={48}
        color={clinicalTokens.colors.primary.DEFAULT}
        accessibilityElementsHidden
      />
    </View>
  );

  const biometricIcon = biometricType === 'face' ? (
    <Ionicons
      name="camera-outline"
      size={28}
      color={clinicalTokens.colors.text.secondary}
      accessibilityElementsHidden
    />
  ) : biometricType === 'fingerprint' ? (
    <Ionicons
      name="finger-print"
      size={28}
      color={clinicalTokens.colors.text.secondary}
      accessibilityElementsHidden
    />
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isHidden) return null;

  const biometricLabel =
    biometricType === 'face' ? 'Face ID' : biometricType === 'fingerprint' ? 'Touch ID' : 'Biometrics';

  return (
    <Animated.View
      style={[styles.container, { opacity: fadeAnim }]}
      accessibilityViewIsModal={visible}
      accessibilityLabel="Biometric authentication screen"
      importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
    >
      {/* Frosted-glass backdrop */}
      <View style={styles.backdrop} />

      {/* Content */}
      <View style={styles.content}>
        {/* Lock icon */}
        {lockIcon}

        {/* Biometric type icon */}
        {biometricIcon && <View style={styles.biometricBadge}>{biometricIcon}</View>}

        {/* Title */}
        <Text
          style={styles.title}
          accessibilityRole="header"
        >
          Authenticate to continue
        </Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {biometricType
            ? `Use ${biometricLabel} to unlock E-Logbook`
            : 'Authenticate to access your patient records'}
        </Text>

        {/* Status message */}
        {statusMessage && (
          <View style={styles.statusContainer}>
            <Ionicons
              name={attempts >= MAX_ATTEMPTS ? 'warning' : 'close-circle'}
              size={18}
              color={clinicalTokens.colors.danger.DEFAULT}
              accessibilityElementsHidden
            />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        )}

        {/* Verify button (manual trigger) */}
        {!isVerifying && attempts < MAX_ATTEMPTS && (
          <TouchableOpacity
            style={styles.verifyButton}
            onPress={triggerBiometric}
            accessibilityRole="button"
            accessibilityLabel={`Try ${biometricLabel} again`}
            activeOpacity={0.7}
          >
            <Ionicons
              name={biometricType === 'face' ? 'camera-outline' : 'finger-print'}
              size={20}
              color={clinicalTokens.colors.text.onPrimary}
              accessibilityElementsHidden
            />
            <Text style={styles.verifyButtonText}>
              {attempts > 0 ? 'Try Again' : `Use ${biometricLabel}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Verifying indicator */}
        {isVerifying && (
          <View style={styles.verifyButton}>
            <Text style={styles.verifyButtonText}>Verifying…</Text>
          </View>
        )}

        {/* "Use Passcode" fallback */}
        {(attempts >= MAX_ATTEMPTS || attempts > 0) && (
          <TouchableOpacity
            style={styles.fallbackButton}
            onPress={handleFallback}
            accessibilityRole="button"
            accessibilityLabel="Use passcode instead"
            activeOpacity={0.7}
          >
            <Ionicons
              name="keypad"
              size={18}
              color={clinicalTokens.colors.primary.DEFAULT}
              accessibilityElementsHidden
            />
            <Text style={styles.fallbackButtonText}>Use Passcode</Text>
          </TouchableOpacity>
        )}

        {/* Attempts indicator */}
        <View style={styles.attemptsRow} accessibilityElementsHidden>
          {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.attemptDot,
                i < attempts && styles.attemptDotFilled,
              ]}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: clinicalTokens.colors.backdrop.dark,
    // Translucent overlay to obscure content beneath
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    maxWidth: 380,
  },
  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: clinicalTokens.colors.backdrop.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    // Apple-style shadow
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  biometricBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: clinicalTokens.colors.neutral.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -28,
    marginBottom: 24,
    // Subtle ring
    borderWidth: 2,
    borderColor: clinicalTokens.colors.backdrop.dark,
  },
  title: {
    fontFamily: clinicalTokens.fonts.heading,
    fontSize: 22,
    fontWeight: '700',
    color: clinicalTokens.colors.text.primary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: clinicalTokens.fonts.body,
    fontSize: 15,
    color: clinicalTokens.colors.text.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: clinicalTokens.colors.danger.bg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: clinicalTokens.radius.md,
    marginBottom: 20,
    gap: 8,
  },
  statusText: {
    fontFamily: clinicalTokens.fonts.body,
    fontSize: 14,
    color: clinicalTokens.colors.danger.DEFAULT,
    flexShrink: 1,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: clinicalTokens.colors.primary.DEFAULT,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: clinicalTokens.radius.xl,
    gap: 10,
    minWidth: 200,
    ...Platform.select({
      ios: {
        shadowColor: clinicalTokens.colors.primary.DEFAULT,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  verifyButtonText: {
    fontFamily: clinicalTokens.fonts.heading,
    fontSize: 16,
    fontWeight: '600',
    color: clinicalTokens.colors.text.onPrimary,
  },
  fallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 8,
  },
  fallbackButtonText: {
    fontFamily: clinicalTokens.fonts.body,
    fontSize: 15,
    color: clinicalTokens.colors.primary.DEFAULT,
    fontWeight: '500',
  },
  attemptsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 32,
  },
  attemptDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: clinicalTokens.colors.neutral.light,
  },
  attemptDotFilled: {
    backgroundColor: clinicalTokens.colors.danger.DEFAULT,
  },
});
