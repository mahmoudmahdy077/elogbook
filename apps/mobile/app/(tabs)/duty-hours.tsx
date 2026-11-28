import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { bestKnownCapability, noteAuthFailure } from '../../lib/session';
import { submitDutyHours } from '../../lib/operations';
import { buildDutyPeriodPayload } from '../../lib/duty-payload';
import { clinicalTokens, DUTY_SHIFT_TYPES, localWeekStartISO } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

// DB-valid shift types from the shared package (migration 00069 parity).
const SHIFT_TYPES = DUTY_SHIFT_TYPES;

export default function DutyHoursScreen() {
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [hours, setHours] = useState('');
  const [shiftType, setShiftType] = useState<string>('regular');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [weeklyHours, setWeeklyHours] = useState<number | null>(null);
  const [weeklyViolation, setWeeklyViolation] = useState(false);
  const [recent, setRecent] = useState<Array<{ id: string; shift_date: string; hours_worked: number; shift_type: string }>>([]);

  const loadWeek = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) return;

    // Monday-start local week, matching date_trunc('week') in the view.
    const weekStart = localWeekStartISO();

    const { data: periods } = await supabase
      .from('duty_periods')
      .select('hours_worked')
      .eq('resident_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .gte('shift_date', weekStart)
      .limit(200);

    const total = (periods ?? []).reduce(
      (sum: number, row: { hours_worked: number | string | null }) =>
        sum + Number(row.hours_worked ?? 0),
      0,
    );
    setWeeklyHours(total);

    const { data: recentRows } = await supabase
      .from('duty_periods')
      .select('id, shift_date, hours_worked, shift_type')
      .eq('resident_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .order('shift_date', { ascending: false })
      .limit(10);
    setRecent((recentRows ?? []) as typeof recent);

    const { data: violation } = await supabase
      .from('duty_weekly_violations')
      .select('total_hours')
      .eq('resident_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .eq('week_start', weekStart)
      .maybeSingle();
    setWeeklyViolation(Boolean(violation));
  }, []);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const handleSave = async () => {
    if (!hours || isNaN(Number(hours))) {
      Alert.alert('Invalid hours', 'Please enter a valid number of hours.');
      return;
    }

    setSaving(true);
    // N2: typed adapter (capability gate + fixed UI copy; raw errors logged).
    const capability = await bestKnownCapability(supabase as never);
    const outcome = await submitDutyHours({
      capability,
      write: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('policy: no verified session');
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, tenant_id')
          .eq('user_id', user.id)
          .single();
        if (!profile) throw new Error('policy: profile_not_found');
        const { error } = await supabase
          .from('duty_periods')
          .insert(buildDutyPeriodPayload(profile as { id: string; tenant_id: string }, date, hours, shiftType, notes));
        if (error) {
          if (/401|403/.test(error.message)) noteAuthFailure(403);
          throw new Error(error.message);
        }
      },
    });

    setSaving(false);
    if (outcome.kind === 'confirmed') {
      Alert.alert('Saved', 'Duty hours recorded.');
      setHours('');
      setNotes('');
      void loadWeek();
    } else if (outcome.kind === 'denied') {
      Alert.alert('Not permitted', outcome.reason);
    } else if (outcome.kind === 'transient') {
      Alert.alert('Connection issue', 'Could not save duty hours. Check your connection and retry.');
    } else {
      Alert.alert('Error', outcome.copy);
    }
  };

  return (
    <ScreenWrapper title="Duty Hours" featureKey="duty_hours">
      <Animated.View entering={FadeIn.delay(100).springify()}>
        <Text className="text-[#000000] text-xl mb-4" style={{ fontFamily: clinicalTokens.fonts.heading }}>Log Duty Hours</Text>
      </Animated.View>

      {weeklyHours !== null && (
        <Animated.View entering={FadeInDown.delay(120).springify()}>
          <View
            style={{
              backgroundColor: weeklyViolation ? 'rgba(255,59,48,0.12)' : '#FFFFFF',
              borderColor: weeklyViolation ? 'rgba(255,59,48,0.4)' : 'rgba(0,122,255,0.15)',
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: clinicalTokens.fonts.body, color: clinicalTokens.colors.text.muted }}>
                This week
              </Text>
              <Text style={{ fontFamily: clinicalTokens.fonts.mono, fontSize: 16, color: clinicalTokens.colors.text.primary }}>
                {weeklyHours.toFixed(1)} h
              </Text>
            </View>
            {weeklyViolation && (
              <Text style={{ marginTop: 6, fontFamily: clinicalTokens.fonts.body, fontSize: 13, color: clinicalTokens.colors.status.text.danger }}>
                Above the 80-hour weekly limit. Your program director will see this in the duty-hour report.
              </Text>
            )}
          </View>
        </Animated.View>
      )}

      <Animated.View entering={FadeInDown.delay(150).springify()}>
        <TouchableOpacity onPress={() => setShowDatePicker(true)} className="bg-gray-200 rounded-xl px-4 py-3 mb-3" accessibilityLabel="Select date" accessibilityRole="button">
          <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.body }}>{date.toLocaleDateString()}</Text>
        </TouchableOpacity>
      </Animated.View>

      {showDatePicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => {
            setShowDatePicker(false);
            if (d) setDate(d);
          }}
        />
      )}

      <Animated.View entering={FadeInDown.delay(200).springify()}>
        <TextInput
          className="bg-white text-[#000000] rounded-xl px-4 py-3 mb-3 border border-[#007AFF]/15"
          placeholder="Hours (e.g., 8.5)"
          placeholderTextColor="#666"
          value={hours}
          onChangeText={setHours}
          keyboardType="numeric"
          accessibilityLabel="Hours worked"
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(250).springify()}>
        <View className="flex-row flex-wrap gap-2 mb-3">
          {SHIFT_TYPES.map((t) => (
            <TouchableOpacity
              key={t.key}
              className={`rounded-lg px-3 py-2 border ${shiftType === t.key ? 'bg-primary border-teal-500' : 'bg-gray-200 border-[#007AFF]/15'}`}
              onPress={() => setShiftType(t.key)}
              accessibilityLabel={t.label}
              accessibilityRole="button"
            >
              <Text className={shiftType === t.key ? 'text-white' : 'text-gray-900'} style={{ fontFamily: clinicalTokens.fonts.body }}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(300).springify()}>
        <TextInput
          className="bg-white text-white rounded-xl px-4 py-3 mb-4 border border-[#007AFF]/15"
          placeholder="Notes (optional)"
          placeholderTextColor="#666"
          value={notes}
          onChangeText={setNotes}
          accessibilityLabel="Notes"
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(350).springify()}>
        <TouchableOpacity
          className={`bg-primary rounded-xl py-4 items-center ${saving ? 'opacity-50' : ''}`}
          onPress={handleSave}
          disabled={saving}
          accessibilityLabel="Save duty hours"
          accessibilityRole="button"
        >
          <Text className="text-white font-bold" style={{ fontFamily: clinicalTokens.fonts.heading }}>Save</Text>
        </TouchableOpacity>
      </Animated.View>

      {recent.length > 0 && (
        <Animated.View entering={FadeInDown.delay(400).springify()} style={{ marginTop: 24 }}>
          <Text
            style={{
              fontFamily: clinicalTokens.fonts.heading,
              fontWeight: '600',
              fontSize: 17,
              color: clinicalTokens.colors.text.primary,
              marginBottom: 8,
            }}
          >
            Recent entries
          </Text>
          {recent.map((entry) => (
            <View
              key={entry.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                backgroundColor: '#FFFFFF',
                borderRadius: 10,
                borderWidth: 1,
                borderColor: 'rgba(0,122,255,0.12)',
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 6,
              }}
            >
              <Text style={{ fontFamily: clinicalTokens.fonts.mono, fontSize: 13, color: clinicalTokens.colors.text.primary }}>
                {entry.shift_date}
              </Text>
              <Text style={{ fontFamily: clinicalTokens.fonts.body, fontSize: 13, color: clinicalTokens.colors.text.secondary }}>
                {Number(entry.hours_worked)}h · {entry.shift_type}
              </Text>
            </View>
          ))}
        </Animated.View>
      )}
    </ScreenWrapper>
  );
}