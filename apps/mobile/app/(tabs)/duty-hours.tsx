import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import { clinicalTokens } from '@elogbook/shared';
import ScreenWrapper from '../../components/ScreenWrapper';

const SHIFT_TYPES = [
  { key: 'call', label: 'Call' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'vacation', label: 'Vacation' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'regular', label: 'Regular' },
] as const;

export default function DutyHoursScreen() {
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [hours, setHours] = useState('');
  const [shiftType, setShiftType] = useState<string>('regular');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!hours || isNaN(Number(hours))) {
      Alert.alert('Invalid hours', 'Please enter a valid number of hours.');
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      setSaving(false);
      Alert.alert('Error', 'Unable to save duty hours.');
      return;
    }

    const { error } = await supabase.from('duty_periods').insert({
      tenant_id: profile.tenant_id,
      resident_id: (profile as unknown as { id: string }).id,
      shift_date: date.toISOString().slice(0, 10),
      hours_worked: Number(hours),
      shift_type: shiftType,
      notes: notes || null,
    });

    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved', 'Duty hours recorded.');
      setHours('');
      setNotes('');
    }
  };

  return (
    <ScreenWrapper title="Duty Hours" scroll={false}>
      <Animated.View entering={FadeIn.delay(100).springify()}>
        <Text className="text-[#000000] text-xl mb-4" style={{ fontFamily: clinicalTokens.fonts.heading }}>Log Duty Hours</Text>
      </Animated.View>

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
    </ScreenWrapper>
  );
}