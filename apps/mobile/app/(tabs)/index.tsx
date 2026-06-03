import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

interface Stats {
  draft: number;
  pending: number;
  approved: number;
}

export default function DashboardScreen() {
  const [stats, setStats] = useState<Stats>({ draft: 0, pending: 0, approved: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!profile) return;

    const { data: cases } = await supabase
      .from('case_entries')
      .select('status')
      .eq('resident_id', profile.id);

    if (cases) {
      const counts = { draft: 0, pending: 0, approved: 0 };
      for (const c of cases) {
        if (c.status === 'draft') counts.draft++;
        else if (c.status === 'pending') counts.pending++;
        else if (c.status === 'approved') counts.approved++;
      }
      setStats(counts);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">Dashboard</Text>

      <View className="flex-row gap-3 mb-6">
        <View className="flex-1 bg-yellow-900/30 rounded-xl p-4 border border-yellow-700/50">
          <Text className="text-yellow-400 text-3xl font-bold">{stats.draft}</Text>
          <Text className="text-yellow-500 mt-1">Drafts</Text>
        </View>
        <View className="flex-1 bg-blue-900/30 rounded-xl p-4 border border-blue-700/50">
          <Text className="text-blue-400 text-3xl font-bold">{stats.pending}</Text>
          <Text className="text-blue-500 mt-1">Pending</Text>
        </View>
        <View className="flex-1 bg-green-900/30 rounded-xl p-4 border border-green-700/50">
          <Text className="text-green-400 text-3xl font-bold">{stats.approved}</Text>
          <Text className="text-green-500 mt-1">Approved</Text>
        </View>
      </View>

      <TouchableOpacity
        className="bg-blue-600 rounded-xl py-4 items-center"
        onPress={() => router.push('/log-case')}
      >
        <Text className="text-white font-semibold text-base">Log New Case</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
