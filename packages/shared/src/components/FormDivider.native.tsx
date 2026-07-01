import { View, Text } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';

export interface FormDividerProps {
  label: ReactNode;
}

export function FormDivider({ label }: FormDividerProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: clinicalTokens.colors.border.DEFAULT }} />
      <Text style={{ fontSize: 12, color: clinicalTokens.colors.text.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: clinicalTokens.colors.border.DEFAULT }} />
    </View>
  );
}
