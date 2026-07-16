import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Share,
  Platform,
  Alert,
  Dimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { getRoleFromAuth } from '../../lib/auth-guard';
import { clinicalTokens } from '@elogbook/shared';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import type { UserRole } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 80; // padding inside card

// ── Types ─────────────────────────────────────────────────────────────────

interface ResidentStats {
  profileId: string;
  fullName: string;
  role: string;
  totalCases: number;
  approvedCases: number;
  pendingCases: number;
  draftCases: number;
  goals: GoalProgress[];
}

interface GoalProgress {
  title: string;
  current: number;
  target: number;
  specialty: string | null;
}

interface RankEntry {
  rank: number;
  name: string;
  total: number;
  approved: number;
  color: string;
}

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32', '#007AFF', '#8E8E93'];

// ── Leaderboard Bar Chart ──────────────────────────────────────────────────

function LeaderboardBar({
  entry,
  maxTotal,
  index,
}: {
  entry: RankEntry;
  maxTotal: number;
  index: number;
}) {
  const barWidth = maxTotal > 0 ? (entry.total / maxTotal) * CHART_WIDTH : 0;
  const barHeight = 28;

  return (
    <View className="mb-2">
      <View className="flex-row items-center mb-1">
        <View
          className="w-7 h-7 rounded-full items-center justify-center mr-2"
          style={{ backgroundColor: entry.color }}
        >
          <Text className="text-white text-xs font-bold">#{entry.rank}</Text>
        </View>
        <Text
          className="flex-1 text-sm"
          style={{
            fontFamily: clinicalTokens.fonts.body,
            fontWeight: '600',
            color: clinicalTokens.colors.text.primary,
          }}
          numberOfLines={1}
        >
          {entry.name}
        </Text>
        <Text
          className="text-xs ml-2"
          style={{
            fontFamily: clinicalTokens.fonts.mono,
            color: clinicalTokens.colors.text.muted,
          }}
        >
          {entry.total} cases
        </Text>
      </View>
      {/* SVG bar */}
      <Svg width={CHART_WIDTH} height={barHeight}>
        <Rect
          x={0}
          y={0}
          width={CHART_WIDTH}
          height={barHeight}
          rx={6}
          ry={6}
          fill={clinicalTokens.colors.border.DEFAULT}
        />
        <Rect
          x={0}
          y={0}
          width={Math.max(barWidth, 4)}
          height={barHeight}
          rx={6}
          ry={6}
          fill={entry.color}
          opacity={0.85}
        />
        <SvgText
          x={8}
          y={barHeight / 2 + 4}
          fontSize={12}
          fontWeight="600"
          fill="#FFFFFF"
        >
          {entry.approved} approved
        </SvgText>
      </Svg>
    </View>
  );
}

// ── Goal Progress Ring ────────────────────────────────────────────────────

function MiniProgressRing({
  current,
  target,
  label,
}: {
  current: number;
  target: number;
  label: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const size = 72;

  return (
    <View className="items-center mr-3 mb-3">
      <Svg width={size} height={size}>
        {/* Background circle */}
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={size / 2}
          ry={size / 2}
          fill={clinicalTokens.colors.border.DEFAULT}
        />
        {/* Progress arc: just draw a simple filled portion */}
        <Rect
          x={4}
          y={4}
          width={(size - 8) * (pct / 100)}
          height={size - 8}
          rx={(size - 8) / 2}
          ry={(size - 8) / 2}
          fill={clinicalTokens.colors.primary.DEFAULT}
        />
        <SvgText
          x={size / 2}
          y={size / 2 + 5}
          fontSize={16}
          fontWeight="bold"
          fill="#FFFFFF"
          textAnchor="middle"
        >
          {Math.round(pct)}%
        </SvgText>
      </Svg>
      <Text
        className="text-center mt-1"
        style={{
          fontFamily: clinicalTokens.fonts.body,
          fontSize: 10,
          color: clinicalTokens.colors.text.muted,
          maxWidth: size + 8,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [residents, setResidents] = useState<ResidentStats[]>([]);
  const [role, setRole] = useState<UserRole | null>(null);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadData = useCallback(async () => {
    const { role: userRole, profileId, tenantId } = await getRoleFromAuth();
    setRole(userRole);
    setCurrentProfileId(profileId);

    if (!tenantId) {
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    try {
      // Fetch all profiles in this tenant (residents only + current user)
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, full_name, role, user_id')
        .eq('tenant_id', tenantId)
        .limit(50);

      if (!allProfiles) { setLoading(false); return; }

      // Fetch all case entries in this tenant
      const { data: allCases } = await supabase
        .from('case_entries')
        .select('id, resident_id, status')
        .eq('tenant_id', tenantId)
        .limit(500);

      // Fetch all program goals with progress
      const { data: allGoals } = await supabase
        .from('program_goals')
        .select('id, title, target_count, specialty, resident_id, tenant_id, goal_progress(current_count)')
        .eq('tenant_id', tenantId)
        .limit(100);

      // Build resident stats
      const caseMap = new Map<string, { total: number; approved: number; pending: number; draft: number }>();
      if (allCases) {
        for (const c of allCases) {
          const rId = c.resident_id as string;
          if (!caseMap.has(rId)) {
            caseMap.set(rId, { total: 0, approved: 0, pending: 0, draft: 0 });
          }
          const stats = caseMap.get(rId)!;
          stats.total++;
          if (c.status === 'approved') stats.approved++;
          else if (c.status === 'pending') stats.pending++;
          else if (c.status === 'draft') stats.draft++;
        }
      }

      const goalMap = new Map<string, GoalProgress[]>();
      if (allGoals) {
        for (const g of allGoals as any[]) {
          const rId = g.resident_id as string;
          if (!goalMap.has(rId)) goalMap.set(rId, []);
          goalMap.get(rId)!.push({
            title: g.title,
            current: g.goal_progress?.[0]?.current_count ?? 0,
            target: g.target_count,
            specialty: g.specialty,
          });
        }
      }

      const stats: ResidentStats[] = allProfiles
        .filter((p) => p.role === 'resident' || p.id === profileId)
        .map((p) => ({
          profileId: p.id,
          fullName: p.full_name ?? 'Unknown',
          role: p.role,
          totalCases: caseMap.get(p.id)?.total ?? 0,
          approvedCases: caseMap.get(p.id)?.approved ?? 0,
          pendingCases: caseMap.get(p.id)?.pending ?? 0,
          draftCases: caseMap.get(p.id)?.draft ?? 0,
          goals: goalMap.get(p.id) ?? [],
        }))
        .sort((a, b) => b.totalCases - a.totalCases);

      setResidents(stats);
    } catch {
      // Silent fail — data may not be available
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── Share Handler ────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const rankEntries = residents.map((r, i) => ({
        rank: i + 1,
        name: r.fullName,
        total: r.totalCases,
        approved: r.approvedCases,
        color: RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)],
      }));

      let message = '📊 *E-Logbook Analytics*\n\n';
      message += '*Leaderboard*\n';
      for (const e of rankEntries) {
        const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`;
        message += `${medal} ${e.name}: ${e.total} cases (${e.approved} approved)\n`;
      }

      message += '\n*Goal Progress*\n';
      for (const r of residents) {
        if (r.goals.length > 0) {
          message += `\n${r.fullName}:\n`;
          for (const g of r.goals) {
            const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
            message += `  • ${g.title}: ${g.current}/${g.target} (${pct}%)\n`;
          }
        }
      }

      message += '\n— E-Logbook App';

      await Share.share({
        message,
        title: 'E-Logbook Analytics',
      });
    } catch {
      // User cancelled or share failed
    } finally {
      setSharing(false);
    }
  }, [residents]);

  // ── Build leaderboard ───────────────────────────────────────────────
  const rankEntries: RankEntry[] = residents.map((r, i) => ({
    rank: i + 1,
    name: r.fullName,
    total: r.totalCases,
    approved: r.approvedCases,
    color: RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)],
  }));

  const maxTotal = Math.max(...residents.map((r) => r.totalCases), 1);

  // ── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  const currentUserStats = residents.find((r) => r.profileId === currentProfileId);
  const currentUserRank = rankEntries.find((r) => r.total === (currentUserStats?.totalCases ?? 0));

  return (
    <ScreenWrapper title="Analytics" refreshing={refreshing} onRefresh={onRefresh}>
      {/* Personal Stats Card */}
      {currentUserStats && (
        <View
          className="rounded-2xl p-5 mb-5"
          style={{
            backgroundColor: clinicalTokens.colors.primary.DEFAULT,
          }}
        >
          <Text
            className="text-lg mb-1"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '700',
              color: '#FFFFFF',
            }}
          >
            {currentUserStats.fullName}
          </Text>
          <Text
            className="text-sm mb-3"
            style={{
              fontFamily: clinicalTokens.fonts.body,
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            {currentUserRank ? `Rank #${currentUserRank.rank} of ${residents.length}` : 'No data yet'}
          </Text>

          <View className="flex-row gap-3">
            <View className="flex-1 bg-white/20 rounded-xl p-3 items-center">
              <Text className="text-white text-2xl font-bold" style={{ fontFamily: clinicalTokens.fonts.mono }}>
                {currentUserStats.totalCases}
              </Text>
              <Text className="text-white/75 text-xs" style={{ fontFamily: clinicalTokens.fonts.body }}>
                Total
              </Text>
            </View>
            <View className="flex-1 bg-white/20 rounded-xl p-3 items-center">
              <Text className="text-[#34C759] text-2xl font-bold" style={{ fontFamily: clinicalTokens.fonts.mono }}>
                {currentUserStats.approvedCases}
              </Text>
              <Text className="text-white/75 text-xs" style={{ fontFamily: clinicalTokens.fonts.body }}>
                Approved
              </Text>
            </View>
            <View className="flex-1 bg-white/20 rounded-xl p-3 items-center">
              <Text className="text-[#FFD60A] text-2xl font-bold" style={{ fontFamily: clinicalTokens.fonts.mono }}>
                {currentUserStats.pendingCases}
              </Text>
              <Text className="text-white/75 text-xs" style={{ fontFamily: clinicalTokens.fonts.body }}>
                Pending
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Leaderboard */}
      <View className="bg-white rounded-2xl p-5 mb-5 border" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
        <Text
          className="text-lg mb-4"
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '700',
            color: clinicalTokens.colors.text.primary,
          }}
        >
          🏆 Case Leaderboard
        </Text>

        {rankEntries.length === 0 ? (
          <Text style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
            No data available.
          </Text>
        ) : (
          rankEntries.map((entry, i) => (
            <LeaderboardBar
              key={entry.name + i}
              entry={entry}
              maxTotal={maxTotal}
              index={i}
            />
          ))
        )}
      </View>

      {/* Goal Progress */}
      {residents.filter((r) => r.goals.length > 0).length > 0 && (
        <View className="bg-white rounded-2xl p-5 mb-5 border" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
          <Text
            className="text-lg mb-4"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '700',
              color: clinicalTokens.colors.text.primary,
            }}
          >
            🎯 Goal Progress
          </Text>

          {residents
            .filter((r) => r.goals.length > 0)
            .map((r) => (
              <View key={r.profileId} className="mb-4">
                <Text
                  className="text-sm mb-2"
                  style={{
                    fontFamily: clinicalTokens.fonts.body,
                    fontWeight: '600',
                    color: clinicalTokens.colors.text.primary,
                  }}
                >
                  {r.fullName}
                </Text>
                <View className="flex-row flex-wrap">
                  {r.goals.map((g, gi) => (
                    <MiniProgressRing
                      key={gi}
                      current={g.current}
                      target={g.target}
                      label={g.title}
                    />
                  ))}
                </View>
              </View>
            ))}
        </View>
      )}

      {/* Share Button */}
      <TouchableOpacity
        className="bg-primary rounded-2xl py-4 items-center mb-4 flex-row justify-center gap-2"
        onPress={handleShare}
        disabled={sharing || residents.length === 0}
        accessibilityLabel="Share analytics"
        accessibilityRole="button"
        style={{
          shadowColor: clinicalTokens.colors.primary.DEFAULT,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '600' }}>
          {sharing ? 'Sharing...' : '📤 Share Analytics'}
        </Text>
      </TouchableOpacity>

      {/* Image share note */}
      <Text
        className="text-xs text-center mb-6"
        style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}
      >
        Share as formatted text via messaging apps.
        {'\n'}Image sharing coming soon — install react-native-view-shot.
      </Text>
    </ScreenWrapper>
  );
}
