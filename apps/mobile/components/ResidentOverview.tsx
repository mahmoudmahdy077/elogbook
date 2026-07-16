import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { getRoleFromAuth } from '../lib/auth-guard';
import { clinicalTokens } from '@elogbook/shared';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

const RING_SIZE = 80;

function GoalRing({ current, target, label }: { current: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return (
    <View className="items-center mr-3 mb-3">
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Rect x={0} y={0} width={RING_SIZE} height={RING_SIZE} rx={RING_SIZE/2} ry={RING_SIZE/2} fill={clinicalTokens.colors.border.DEFAULT} />
        <Rect x={4} y={4} width={(RING_SIZE-8)*(pct/100)} height={RING_SIZE-8} rx={(RING_SIZE-8)/2} ry={(RING_SIZE-8)/2} fill={clinicalTokens.colors.primary.DEFAULT} />
        <SvgText x={RING_SIZE/2} y={RING_SIZE/2+5} fontSize={16} fontWeight="bold" fill="#FFF" textAnchor="middle">{Math.round(pct)}%</SvgText>
      </Svg>
      <Text className="text-center mt-1" style={{ fontFamily: clinicalTokens.fonts.body, fontSize: 10, color: clinicalTokens.colors.text.muted, maxWidth: RING_SIZE+12 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View className="flex-1 rounded-xl p-3.5 items-center" style={{ backgroundColor: color + '18' }}>
      <Text className="text-2xl font-bold" style={{ fontFamily: clinicalTokens.fonts.mono, color }}>{value}</Text>
      <Text className="text-xs mt-1" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>{label}</Text>
    </View>
  );
}

interface GoalData { title: string; current: number; target: number; specialty: string | null }

export default function ResidentOverview() {
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [total, setTotal] = useState(0);
  const [approved, setApproved] = useState(0);
  const [pending, setPending] = useState(0);
  const [draft, setDraft] = useState(0);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    const { profileId, fullName: name } = await getRoleFromAuth();
    setFullName(name ?? 'Resident');
    if (!profileId) { setLoading(false); return; }
    try {
      const { data: cases } = await supabase.from('case_entries').select('status').eq('resident_id', profileId);
      if (cases) {
        let t=0,a=0,p=0,d=0;
        cases.forEach(c => { t++; if(c.status==='approved') a++; else if(c.status==='pending') p++; else if(c.status==='draft') d++; });
        setTotal(t); setApproved(a); setPending(p); setDraft(d);
      }
      const { data: g } = await supabase.from('program_goals').select('id,title,target_count,specialty,goal_progress(current_count)').eq('resident_id', profileId);
      if (g) setGoals((g as any[]).map(x => ({ title: x.title, current: x.goal_progress?.[0]?.current_count ?? 0, target: x.target_count, specialty: x.specialty })));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const share = useCallback(async () => {
    setSharing(true);
    try {
      let msg = `📊 My E-Logbook Analytics\n\n👤 ${fullName}\n\n📋 Cases\n  Total: ${total}\n  ✅ Approved: ${approved}\n  ⏳ Pending: ${pending}\n  📝 Draft: ${draft}\n`;
      if (goals.length > 0) { msg += `\n🎯 Goals\n`; goals.forEach(g => { const p = g.target>0 ? Math.round(g.current/g.target*100) : 0; msg += `  • ${g.title}: ${g.current}/${g.target} (${p}%)\n`; }); }
      msg += `\n— E-Logbook`;
      await Share.share({ message: msg, title: 'My E-Logbook Analytics' });
    } catch { /* cancelled */ }
    setSharing(false);
  }, [fullName, total, approved, pending, draft, goals]);

  if (loading) return (
    <View className="flex-1 items-center justify-center"><ActivityIndicator color={clinicalTokens.colors.primary.DEFAULT} size="large" /></View>
  );

  const rate = total > 0 ? Math.round(approved / total * 100) : 0;

  return (
    <View className="flex-1 px-5">
      <View className="mb-5">
        <Text className="text-2xl mb-1" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '700', color: clinicalTokens.colors.text.primary }}>Hey, {fullName.split(' ')[0]} 👋</Text>
        <Text className="text-sm" style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>Here's your case progress</Text>
      </View>

      <View className="items-center mb-6">
        <Svg width={100} height={100}>
          <Rect x={0} y={0} width={100} height={100} rx={50} ry={50} fill={clinicalTokens.colors.primary.DEFAULT} />
          <SvgText x={50} y={42} fontSize={28} fontWeight="bold" fill="#FFF" textAnchor="middle">{rate}%</SvgText>
          <SvgText x={50} y={64} fontSize={12} fill="rgba(255,255,255,0.7)" textAnchor="middle">approved</SvgText>
        </Svg>
      </View>

      <Animated.View entering={FadeIn.delay(100)} className="flex-row gap-3 mb-6">
        <StatTile value={total} label="Total" color={clinicalTokens.colors.primary.DEFAULT} />
        <StatTile value={approved} label="Approved" color="#34C759" />
        <StatTile value={pending + draft} label="In Progress" color="#FF9500" />
      </Animated.View>

      {goals.length > 0 && (
        <Animated.View entering={FadeIn.delay(200)} className="bg-white rounded-2xl p-5 mb-5 border" style={{ borderColor: clinicalTokens.colors.border.DEFAULT }}>
          <Text className="text-lg mb-4" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight: '700', color: clinicalTokens.colors.text.primary }}>🎯 My Goals</Text>
          <View className="flex-row flex-wrap">{goals.map((g,i) => <GoalRing key={i} current={g.current} target={g.target} label={g.title} />)}</View>
        </Animated.View>
      )}

      <Animated.View entering={SlideInUp.delay(300)}>
        <TouchableOpacity className="bg-primary rounded-2xl py-4 items-center mb-6 flex-row justify-center gap-2" onPress={share} disabled={sharing}
          style={{ shadowColor: clinicalTokens.colors.primary.DEFAULT, shadowOffset: {width:0,height:4}, shadowOpacity:0.3, shadowRadius:8, elevation:6 }}>
          <Text className="text-white text-base" style={{ fontFamily: clinicalTokens.fonts.heading, fontWeight:'600' }}>{sharing ? 'Sharing...' : '📤 Share My Progress'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
