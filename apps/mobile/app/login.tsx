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

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/(tabs)');
      }
    });
  }, []);

  const handleSendLink = async () => {
    if (!email.trim()) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setLoading(false);
    if (error) {
      console.error(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-black px-6 justify-center"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="items-center mb-10">
        <Text className="text-white text-3xl font-bold">E-Logbook</Text>
        <Text className="text-gray-400 mt-2 text-center">
          Surgical logbook for residents & institutions
        </Text>
      </View>

      {sent ? (
        <View className="bg-gray-900 rounded-xl p-6 border border-gray-800 items-center">
          <Text className="text-white text-lg font-semibold mb-2">Check your email</Text>
          <Text className="text-gray-400 text-center">
            We sent a magic link to {email}
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          <TextInput
            className="bg-gray-900 text-white rounded-xl px-4 py-3 border border-gray-700"
            placeholder="Email address"
            placeholderTextColor="#666"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />

          <TouchableOpacity
            className="bg-blue-600 rounded-xl py-3 items-center"
            onPress={handleSendLink}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">Send Magic Link</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
