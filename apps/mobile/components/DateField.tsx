import { useState } from 'react';
import { Platform, TextInput, TouchableOpacity, Text, View } from 'react-native';
import type { ComponentType } from 'react';

let DateTimePicker: ComponentType<Record<string, unknown>> | null = null;
try {
  // The native module is not available in Vitest's node environment; the
  // require is wrapped in try/catch so the test harness never blows up.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateTimePicker = require('@react-native-community/datetimepicker').default;
} catch {
  DateTimePicker = null;
}

export type DateFieldProps = {
  value: string;
  onChange: (iso: string) => void;
  label: string;
  accessibilityLabel: string;
  maximumDate?: Date;
  minimumDate?: Date;
};

function parseISODate(iso: string): Date {
  // Accepts YYYY-MM-DD or a full ISO string; falls back to "now".
  if (!iso) return new Date();
  if (iso.length === 10) {
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  const t = new Date(iso);
  return isNaN(t.getTime()) ? new Date() : t;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DateField({
  value,
  onChange,
  label,
  accessibilityLabel,
  maximumDate,
  minimumDate,
}: DateFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [focused, setFocused] = useState(false);

  const handleNativeChange = (_event: unknown, date?: Date) => {
    if (Platform.OS !== 'ios') setShowPicker(false);
    if (date) onChange(toISODate(date));
  };

  if (DateTimePicker) {
    return (
      <View>
        <Text className="text-gray-400 mb-2" accessibilityRole="text">{label}</Text>
        <TouchableOpacity
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          onPress={() => setShowPicker(true)}
          className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
        >
          <Text className="text-white">{value || 'YYYY-MM-DD'}</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={parseISODate(value)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onChange={handleNativeChange}
          />
        )}
      </View>
    );
  }

  return (
    <View>
      <Text className="text-gray-400 mb-2" accessibilityRole="text">{label}</Text>
      <TextInput
        className="bg-[#060814] text-white rounded-xl px-4 py-3 border border-indigo-500/15"
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#666"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        accessibilityLabel={accessibilityLabel}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {focused && value && !/^\d{4}-\d{2}-\d{2}$/.test(value) && (
        <Text className="text-amber-400 text-xs mt-1" accessibilityRole="text">
          Use YYYY-MM-DD
        </Text>
      )}
    </View>
  );
}
