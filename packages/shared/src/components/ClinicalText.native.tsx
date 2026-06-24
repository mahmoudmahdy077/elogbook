import React, { ReactNode } from 'react';
import { Text, TextStyle, ViewStyle } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';

export type ClinicalTextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ClinicalTextProps {
  children: ReactNode;
  size?: ClinicalTextSize;
  style?: TextStyle | ViewStyle;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  color?: 'primary' | 'secondary' | 'muted' | 'onPrimary';
}

const sizeValues: Record<ClinicalTextSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

const weightValues = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

const colorValues = {
  primary: clinicalTokens.colors.text.primary,
  secondary: clinicalTokens.colors.text.secondary,
  muted: clinicalTokens.colors.text.muted,
  onPrimary: clinicalTokens.colors.text.onPrimary,
};

export function ClinicalText({
  children,
  size = 'md',
  style,
  weight = 'normal',
  color = 'primary',
}: ClinicalTextProps) {
  return (
    <Text
      style={[
        {
          fontFamily: clinicalTokens.fonts.mono,
          fontSize: sizeValues[size],
          fontWeight: weightValues[weight],
          color: colorValues[color],
          fontVariant: ['tabular-nums'],
        } as TextStyle,
        style,
      ]}
    >
      {children}
    </Text>
  );
}