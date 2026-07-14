import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, RefreshControl, AppState } from 'react-native';
import { router } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { getAllGoalsForResident, getAllCasesForResident, getLastSyncTimestamp } from '../../lib/db/storage';
import { syncService } from '../../lib/sync';
import { NativeProgressRing as ProgressRing } from '@elogbook/shared/components/native';
import { AccessibleText } from '../../components/AccessibleText';
import { clinicalTokens } from '@elogbook/shared';
import { CaseCountWidget } from '../../components/CaseCountWidget';
import { fetchTodayStats } from '../../lib/today-stats';
import type { TodayStats } from '../../lib/today-stats';

interface Stats {
  draft: number;
  pending: number;
  approved: number;
}

interface GoalData {
  id: string;
  title: string;
  current: number;
  target: number;
  specialty: string | null;
}

export default function DashboardScreen() {
  const [stats, setStats] = useState<Stats>({ draft: 0, pending: 0, approved: 0 });
  const [todayStats, setTodayStats] = useState<TodayStats>({ total: 0, pending: 0, approved: 0, rejected: 0, draft: 0 });
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncAgo, setLastSyncAgo] = useState<string>('');

  useEffect(() => {
    loadData();

    const netUnsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected !== true);
    });

    const syncUnsub = syncService.onStatusChange((status) => {
      if (status === 'synced' || status === 'idle') {
        loadData();
        updateLastSyncLabel();
      }
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        loadData();
      }
    });

    updateLastSyncLabel();
    const interval = setInterval(updateLastSyncLabel, 60000);

    return () => {
      netUnsub();
      syncUnsub();
      appStateSub.remove();
      clearInterval(interval);
    };
  }, []);

  const updateLastSyncLabel = async () => {
    const ts = await getLastSyncTimestamp();
    if (!ts) {
      setLastSyncAgo('Never');
      return;
    }
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) setLastSyncAgo('Just now');
    else if (diffMin < 60) setLastSyncAgo(`${diffMin}m ago`);
    else setLastSyncAgo(`${Math.floor(diffMin / 60)}h ago`);
  };

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) { setLoading(false); return; }

    const netState = await NetInfo.fetch();

    if (netState.isConnected) {
      const { data: goalsWithProgress } = await supabase
        .from('program_goals')
        .select('id, title, target_count, specialty, resident_id, tenant_id, goal_progress(current_count)')
        .eq('resident_id', profile.id)
        .eq('tenant_id', profile.tenant_id);

      if (goalsWithProgress) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setGoals(goalsWithProgress.map((g: any) => ({
          id: g.id,
          title: g.title,
          current: g.goal_progress?.[0]?.current_count ?? 0,
          target: g.target_count,
          specialty: g.specialty,
        })));
      }
    } else {
      const localGoals = await getAllGoalsForResident(profile.id);
      setGoals(localGoals.map((g) => ({
        id: g.id,
        title: g.title,
        current: g.currentCount,
        target: g.targetCount,
        specialty: g.specialty,
      })));
    }

    const localCases = await getAllCasesForResident(profile.id);
    if (localCases.length > 0) {
      const counts = { draft: 0, pending: 0, approved: 0 };
      for (const c of localCases) {
        if (c.status === 'draft') counts.draft++;
        else if (c.status === 'pending') counts.pending++;
        else if (c.status === 'approved') counts.approved++;
      }
      setStats(counts);
    } else if (netState.isConnected) {
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
    }

    // Fetch today's stats for the widget
    const todayStatsResult = await fetchTodayStats();
    setTodayStats(todayStatsResult);

    setLoading(false);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  if (loading) {
    return (
      <View className="flex-1 bg-backdrop items-center justify-center">
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-backdrop px-4 pt-4"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={clinicalTokens.colors.primary.DEFAULT}
          colors={[clinicalTokens.colors.primary.DEFAULT]}
        />
      }
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-white text-2xl" style={{ fontFamily: clinicalTokens.fonts.heading }}>Dashboard</Text>
        <Text className="text-gray-400 text-xs" style={{ fontFamily: clinicalTokens.fonts.body }}>
          Last synced: {lastSyncAgo}
        </Text>
      </View>

      {isOffline && (
        <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
          <Text className="text-red-400 text-sm text-center" style={{ fontFamily: clinicalTokens.fonts.body }}>Offline — showing cached data</Text>
        </View>
      )}

      {/* Today's case count widget */}
      {todayStats.total > 0 && <CaseCountWidget stats={todayStats} dailyGoal={10} />}

      <View className="flex-row gap-3 mb-6">
        <View
          className="flex-1 bg-white rounded-xl p-4 border border-[#007AFF]/15"
          accessible
          accessibilityLabel={`${stats.draft} drafts`}
        >
          <AccessibleText
            className="text-gray-500 text-3xl"
            accessibilityLabel={`${stats.draft} drafts`}
            style={{ fontFamily: clinicalTokens.fonts.mono }}
          >
            {stats.draft}
          </AccessibleText>
          <AccessibleText
            className="text-gray-400 mt-1 text-xs"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          >
            Drafts
          </AccessibleText>
        </View>
        <View
          className="flex-1 bg-amber-500/10 rounded-xl p-4 border border-amber-500/30"
          accessible
          accessibilityLabel={`${stats.pending} pending`}
        >
          <AccessibleText
            className="text-amber-400 text-3xl"
            accessibilityLabel={`${stats.pending} pending`}
            style={{ fontFamily: clinicalTokens.fonts.mono }}
          >
            {stats.pending}
          </AccessibleText>
          <AccessibleText
            className="text-amber-500 mt-1 text-xs"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          >
            Pending
          </AccessibleText>
        </View>
        <View
          className="flex-1 bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/30"
          accessible
          accessibilityLabel={`${stats.approved} approved`}
        >
          <AccessibleText
            className="text-emerald-400 text-3xl"
            accessibilityLabel={`${stats.approved} approved`}
            style={{ fontFamily: clinicalTokens.fonts.mono }}
          >
            {stats.approved}
          </AccessibleText>
          <AccessibleText
            className="text-emerald-500 mt-1 text-xs"
            style={{ fontFamily: clinicalTokens.fonts.body }}
          >
            Approved
          </AccessibleText>
        </View>
      </View>

      {goals.length > 0 && (
        <View className="mb-6">
          <Text className="text-white text-lg mb-4" style={{ fontFamily: clinicalTokens.fonts.heading }}>Goal Progress</Text>
          <View className="flex-row gap-4 flex-wrap">
            {goals.map((g) => (
              <ProgressRing
                key={g.id}
                value={g.target > 0 ? (g.current / g.target) * 100 : 0}
                label={g.title}
                color={clinicalTokens.colors.primary.DEFAULT}
                size={110}
              />
            ))}
          </View>
          <View className="mt-3 bg-white rounded-xl p-4 border border-[#007AFF]/15">
          <Text className="text-white text-sm" style={{ fontFamily: clinicalTokens.fonts.heading }}>
            {goals.filter(g => g.target > 0 && g.current >= g.target).length} of {goals.length} goals on track
          </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        className="bg-teal-600 rounded-xl py-4 items-center mb-8"
        onPress={() => router.push('/log-case')}
      >
        <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading }}>Log New Case</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}