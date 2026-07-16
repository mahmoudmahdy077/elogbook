import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Dimensions,
  RefreshControl,
} from 'react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { getRoleFromAuth } from '../../lib/auth-guard';
import { clinicalTokens } from '@elogbook/shared';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import ScreenWrapper from '../../components/ScreenWrapper';

const GOAL_RING_SIZE = 80;

// ── Mini Progress Ring ────────────────────────────────────────────────────

function GoalRing({
  current,
  target,
  label,
}: {
  current: number;
  target: number;
  label: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const size = GOAL_RING_SIZE;

  return (
    <View className="items-center mr-3 mb-3">
      <Svg width={size} height={size}>
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={size / 2}
          ry={size / 2}
          fill={clinicalTokens.colors.border.DEFAULT}
        />
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
          maxWidth: size + 12,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Stats Tile ────────────────────────────────────────────────────────────

function StatTile({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <View
      className="flex-1 rounded-xl p-3.5 items-center"
      style={{ backgroundColor: color + '18' }}
    >
      <Text
        className="text-2xl font-bold"
        style={{ fontFamily: clinicalTokens.fonts.mono, color }}
      >
        {value}
      </Text>
      <Text
        className="text-xs mt-1"
        style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────

interface GoalData {
  title: string;
  current: number;
  target: number;
  specialty: string | null;
}

export default function AnalyticsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [totalCases, setTotalCases] = useState(0);
  const [approvedCases, setApprovedCases] = useState(0);
  const [pendingCases, setPendingCases] = useState(0);
  const [draftCases, setDraftCases] = useState(0);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [sharing, setSharing] = useState(false);

  const loadData = useCallback(async () => {
    const { profileId, fullName: name } = await getRoleFromAuth();
    setFullName(name ?? 'User');

    if (!profileId) { setLoading(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    try {
      // Get profile + tenant info for scoped queries
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!profile) { setLoading(false); return; }

      // Fetch MY case entries
      const { data: myCases } = await supabase
        .from('case_entries')
        .select('status')
        .eq('resident_id', profileId);

      if (myCases) {
        let total = 0, approved = 0, pending = 0, draft = 0;
        for (const c of myCases) {
          total++;
          if (c.status === 'approved') approved++;
          else if (c.status === 'pending') pending++;
          else if (c.status === 'draft') draft++;
        }
        setTotalCases(total);
        setApprovedCases(approved);
        setPendingCases(pending);
        setDraftCases(draft);
      }

      // Fetch MY goals
      const { data: myGoals } = await supabase
        .from('program_goals')
        .select('id, title, target_count, specialty, goal_progress(current_count)')
        .eq('resident_id', profileId);

      if (myGoals) {
        setGoals(
          (myGoals as any[]).map((g) => ({
            title: g.title,
            current: g.goal_progress?.[0]?.current_count ?? 0,
            target: g.target_count,
            specialty: g.specialty,
          }))
        );
      }
    } catch {
      // silent
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

  // ── Share ─────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      let message = `📊 *My E-Logbook Analytics*\n\n`;
      message += `👤 ${fullName}\n\n`;
      message += `📋 Cases\n`;
      message += `  Total: ${totalCases}\n`;
      message += `  ✅ Approved: ${approvedCases}\n`;
      message += `  ⏳ Pending: ${pendingCases}\n`;
      message += `  📝 Draft: ${draftCases}\n\n`;

      if (goals.length > 0) {
        message += `🎯 Goal Progress\n`;
        for (const g of goals) {
          const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
          message += `  • ${g.title}: ${g.current}/${g.target} (${pct}%)\n`;
        }
      }

      message += `\n— E-Logbook`;

      await Share.share({ message, title: 'My E-Logbook Analytics' });
    } catch {
      // cancelled
    } finally {
      setSharing(false);
    }
  }, [fullName, totalCases, approvedCases, pendingCases, draftCases, goals]);

  // ── Render ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}>
        <ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" />
      </View>
    );
  }

  const approvalRate = totalCases > 0 ? Math.round((approvedCases / totalCases) * 100) : 0;

  return (
    <ScreenWrapper title="My Analytics" refreshing={refreshing} onRefresh={onRefresh}>
      {/* Greeting + approval rate */}
      <View className="mb-6">
        <Text
          className="text-2xl mb-1"
          style={{
            fontFamily: clinicalTokens.fonts.heading,
            fontWeight: '700',
            color: clinicalTokens.colors.text.primary,
          }}
        >
          Hey, {fullName.split(' ')[0]} 👋
        </Text>
        <Text
          className="text-sm"
          style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}
        >
          Here's your case progress
        </Text>
      </View>

      {/* Mini hero — approval rate ring */}
      <View className="items-center mb-6">
        <Svg width={100} height={100}>
          <Rect
            x={0} y={0} width={100} height={100}
            rx={50} ry={50}
            fill={clinicalTokens.colors.primary.DEFAULT}
          />
          <SvgText
            x={50} y={42}
            fontSize={28}
            fontWeight="bold"
            fill="#FFFFFF"
            textAnchor="middle"
          >
            {approvalRate}%
          </SvgText>
          <SvgText
            x={50} y={64}
            fontSize={12}
            fill="rgba(255,255,255,0.7)"
            textAnchor="middle"
          >
            approved
          </SvgText>
        </Svg>
      </View>

      {/* Stats row */}
      <Animated.View entering={FadeIn.delay(100)} className="flex-row gap-3 mb-6">
        <StatTile value={totalCases} label="Total Cases" color={clinicalTokens.colors.primary.DEFAULT} />
        <StatTile value={approvedCases} label="Approved" color="#34C759" />
        <StatTile value={pendingCases + draftCases} label="In Progress" color="#FF9500" />
      </Animated.View>

      {/* Goals */}
      {goals.length > 0 && (
        <Animated.View entering={FadeIn.delay(200)}
          className="bg-white rounded-2xl p-5 mb-5 border"
          style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}
        >
          <Text
            className="text-lg mb-4"
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '700',
              color: clinicalTokens.colors.text.primary,
            }}
          >
            🎯 My Goals
          </Text>
          <View className="flex-row flex-wrap">
            {goals.map((g, i) => (
              <GoalRing
                key={i}
                current={g.current}
                target={g.target}
                label={g.title}
              />
            ))}
          </View>
        </Animated.View>
      )}

      {/* Share */}
      <Animated.View entering={SlideInUp.delay(300)}>
        <TouchableOpacity
          className="bg-primary rounded-2xl py-4 items-center mb-6 flex-row justify-center gap-2"
          onPress={handleShare}
          disabled={sharing}
          accessibilityLabel="Share my analytics"
          accessibilityRole="button"
          style={{
            shadowColor: clinicalTokens.colors.primary.DEFAULT,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Text
            className="text-white text-base"
            style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '600' }}
          >
            {sharing ? 'Sharing...' : '📤 Share My Progress'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </ScreenWrapper>
  );
}
