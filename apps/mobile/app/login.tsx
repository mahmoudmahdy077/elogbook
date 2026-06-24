import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { clinicalTokens } from '@elogbook/shared';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/(tabs)');
      }
    });
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSendLink = async () => {
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOtp({ email: trimmed });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setSent(true);
    setCooldown(true);
    setTimeout(() => setCooldown(false), 5000);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 px-6 justify-center"
      style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="items-center mb-10">
        <Text className="text-white text-3xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>E-Logbook</Text>
        <Text className="text-gray-400 mt-2 text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>
          Surgical logbook for residents &amp; institutions
        </Text>
      </View>

      {sent ? (
        <View className="bg-gray-900 rounded-xl p-6 border border-gray-800 items-center">
          <Text className="text-white text-lg mb-2" style={{ fontFamily: clinicalTokens.fonts.heading }}>Check your email</Text>
          <Text className="text-gray-400 text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>
            We sent a magic link to {email}
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          {error && (
            <View className="bg-red-900/50 border border-red-500/30 rounded-xl px-4 py-3">
              <Text className="text-red-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>{error}</Text>
            </View>
          )}

          <TextInput
            className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="Email address"
            placeholderTextColor="#666"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(text) => { setEmail(text); setError(null); }}
            accessibilityLabel="Email address input"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          />

          <TouchableOpacity
            className="bg-blue-600 rounded-xl py-3 items-center"
            onPress={handleSendLink}
            disabled={loading || cooldown}
            accessibilityLabel="Send magic link"
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading }}>
                {cooldown ? 'Please wait...' : 'Send Magic Link'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}