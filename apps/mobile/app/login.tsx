import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { clearBiometricAuthCache } from '../lib/biometric-auth';
import { setBiometricPreference } from '../lib/secure-store';
import { clinicalTokens } from '@elogbook/shared';

type AuthMode = 'login' | 'signup';

export default function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        clearBiometricAuthCache();
        setBiometricPreference(false).catch(console.error);
        router.replace('/(tabs)');
      }
    });
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const validate = (): string | null => {
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      return 'Please enter a valid email address.';
    }
    if (password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (mode === 'signup' && password !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  };

  const handleSubmit = async () => {
    setError(null);
    setSignupSuccess(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      setLoading(false);

      if (authError) {
        setError(authError.message);
        return;
      }

      // Clear biometric cache on fresh login
      clearBiometricAuthCache();
      setBiometricPreference(false).catch(console.error);
      router.replace('/(tabs)');
    } else {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      setLoading(false);

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      // Show success and switch to login mode
      setSignupSuccess(true);
      setMode('login');
      setPassword('');
      setConfirmPassword('');
    }
  };

  const toggleMode = () => {
    setError(null);
    setSignupSuccess(false);
    setPassword('');
    setConfirmPassword('');
    setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── App branding ─────────────────────────────────────────── */}
        <View className="items-center mb-10">
          <Text
            className="text-[34px] tracking-tight"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '700',
              color: clinicalTokens.colors.text.primary,
            }}
          >
            E-Logbook
          </Text>
          <Text
            className="text-base mt-1.5 text-center"
            style={{
              fontFamily: clinicalTokens.fonts.body,
              color: clinicalTokens.colors.text.secondary,
            }}
          >
            Surgical logbook for residents & institutions
          </Text>
        </View>

        {/* ── Auth card ────────────────────────────────────────────── */}
        <View
          className="rounded-2xl p-5 mb-6"
          style={{
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: clinicalTokens.colors.border.DEFAULT,
          }}
        >
          {/* Header */}
          <Text
            className="text-xl mb-6"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '600',
              color: clinicalTokens.colors.text.primary,
            }}
          >
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </Text>

          {/* Error */}
          {error && (
            <View
              className="mb-4 px-4 py-3 rounded-xl"
              style={{
                backgroundColor: clinicalTokens.colors.danger.bg,
                borderWidth: 1,
                borderColor: 'rgba(255, 59, 48, 0.15)',
              }}
            >
              <Text
                className="text-sm"
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  color: clinicalTokens.colors.danger.DEFAULT,
                }}
              >
                {error}
              </Text>
            </View>
          )}

          {/* Sign-up success message */}
          {signupSuccess && (
            <View
              className="mb-4 px-4 py-3 rounded-xl"
              style={{
                backgroundColor: clinicalTokens.colors.success.bg,
                borderWidth: 1,
                borderColor: 'rgba(52, 199, 89, 0.15)',
              }}
            >
              <Text
                className="text-sm"
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  color: clinicalTokens.colors.success.DEFAULT,
                }}
              >
                Account created! Check your email for a confirmation link, then sign in.
              </Text>
            </View>
          )}

          {/* Email */}
          <View className="mb-4">
            <Text
              className="text-xs uppercase tracking-wider mb-1.5"
              style={{
                fontFamily: clinicalTokens.fonts.body,
                fontWeight: '500',
                color: clinicalTokens.colors.text.muted,
              }}
            >
              Email
            </Text>
            <TextInput
              className="px-4 py-3 rounded-xl text-base"
              style={{
                fontFamily: clinicalTokens.fonts.body,
                backgroundColor: clinicalTokens.colors.backdrop.dark,
                color: clinicalTokens.colors.text.primary,
                borderWidth: 1,
                borderColor: clinicalTokens.colors.border.DEFAULT,
              }}
              placeholder="surgical.resident@hospital.com"
              placeholderTextColor={clinicalTokens.colors.text.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(null);
                setSignupSuccess(false);
              }}
              accessibilityLabel="Email address"
            />
          </View>

          {/* Password */}
          <View className="mb-2">
            <Text
              className="text-xs uppercase tracking-wider mb-1.5"
              style={{
                fontFamily: clinicalTokens.fonts.body,
                fontWeight: '500',
                color: clinicalTokens.colors.text.muted,
              }}
            >
              Password
            </Text>
            <TextInput
              className="px-4 py-3 rounded-xl text-base"
              style={{
                fontFamily: clinicalTokens.fonts.body,
                backgroundColor: clinicalTokens.colors.backdrop.dark,
                color: clinicalTokens.colors.text.primary,
                borderWidth: 1,
                borderColor: clinicalTokens.colors.border.DEFAULT,
              }}
              placeholder={mode === 'login' ? 'Your password' : 'Min. 6 characters'}
              placeholderTextColor={clinicalTokens.colors.text.muted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'login' ? 'password' : 'new-password'}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError(null);
              }}
              accessibilityLabel="Password"
            />
          </View>

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <View className="mb-2">
              <Text
                className="text-xs uppercase tracking-wider mb-1.5"
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  fontWeight: '500',
                  color: clinicalTokens.colors.text.muted,
                }}
              >
                Confirm Password
              </Text>
              <TextInput
                className="px-4 py-3 rounded-xl text-base"
                style={{
                  fontFamily: clinicalTokens.fonts.body,
                  backgroundColor: clinicalTokens.colors.backdrop.dark,
                  color: clinicalTokens.colors.text.primary,
                  borderWidth: 1,
                  borderColor: clinicalTokens.colors.border.DEFAULT,
                }}
                placeholder="Re-enter password"
                placeholderTextColor={clinicalTokens.colors.text.muted}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setError(null);
                }}
                accessibilityLabel="Confirm password"
              />
            </View>
          )}

          {/* Submit button */}
          <TouchableOpacity
            className="py-3.5 rounded-xl items-center mt-4"
            style={{
              backgroundColor: clinicalTokens.colors.primary.DEFAULT,
              opacity: loading ? 0.6 : 1,
            }}
            onPress={handleSubmit}
            disabled={loading}
            accessibilityLabel={mode === 'login' ? 'Sign in' : 'Create account'}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                className="text-base"
                style={{
                  fontFamily: clinicalTokens.fonts.heading,
                  fontWeight: '600',
                  color: clinicalTokens.colors.text.onPrimary,
                }}
              >
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Mode toggle ──────────────────────────────────────────── */}
        <View className="items-center">
          <Text
            className="text-sm mb-1"
            style={{
              fontFamily: clinicalTokens.fonts.body,
              color: clinicalTokens.colors.text.secondary,
            }}
          >
            {mode === 'login'
              ? "Don't have an account?"
              : 'Already have an account?'}
          </Text>
          <TouchableOpacity
            onPress={toggleMode}
            disabled={loading}
            accessibilityLabel={
              mode === 'login' ? 'Switch to sign up' : 'Switch to sign in'
            }
            accessibilityRole="button"
          >
            <Text
              className="text-base"
              style={{
                fontFamily: clinicalTokens.fonts.heading,
                fontWeight: '600',
                color: clinicalTokens.colors.primary.DEFAULT,
              }}
            >
              {mode === 'login' ? 'Create Account' : 'Sign In'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
