import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

interface ProfileData {
  id: string;
  full_name: string;
  role: string;
  specialty: string | null;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, specialty')
      .eq('user_id', user.id)
      .single();

    if (data) setProfile(data as ProfileData);
    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-4">
        <Text className="text-gray-400">Unable to load profile.</Text>
      </View>
    );
  }

  const initial = profile.full_name.charAt(0).toUpperCase();

  return (
    <View className="flex-1 bg-black px-4 pt-4">
      <View className="items-center mb-8 mt-4">
        <View className="w-20 h-20 rounded-full bg-blue-600 items-center justify-center mb-4">
          <Text className="text-white text-3xl font-bold">{initial}</Text>
        </View>
        <Text className="text-white text-xl font-bold">{profile.full_name}</Text>
        <Text className="text-gray-400 mt-1 capitalize">{profile.role.replace('_', ' ')}</Text>
        {profile.specialty && (
          <Text className="text-blue-400 mt-1">{profile.specialty}</Text>
        )}
      </View>

      <TouchableOpacity
        className="bg-red-600/20 rounded-xl py-4 items-center border border-red-600"
        onPress={handleSignOut}
      >
        <Text className="text-red-400 font-semibold">Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
