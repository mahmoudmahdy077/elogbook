import { View, TouchableOpacity, ViewStyle } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';

export interface PanelProps {
  children: ReactNode;
  style?: ViewStyle;
  hoverable?: boolean;
  onPress?: () => void;
}

export function Panel({ children, style, hoverable = false, onPress }: PanelProps) {
  const baseStyle: ViewStyle = {
    backgroundColor: clinicalTokens.colors.neutral.darker,
    borderWidth: 1,
    borderColor: clinicalTokens.colors.border.DEFAULT,
    borderRadius: clinicalTokens.radius.lg,
    padding: clinicalTokens.spacing.md,
  };

  const pressStyle: ViewStyle = {
    ...baseStyle,
    shadowColor: clinicalTokens.colors.neutral.darker,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 8,
  };

  const combinedStyle: ViewStyle[] = [
    baseStyle,
    hoverable && pressStyle,
    style,
  ].filter((s): s is ViewStyle => s !== false && s !== undefined);

  if (onPress) {
    return (
      <TouchableOpacity
        style={combinedStyle}
        onPress={onPress}
        activeOpacity={0.98}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={combinedStyle}>{children}</View>;
}