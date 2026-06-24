import React from 'react';
import { View, ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';

// Type assertion to avoid React Native type conflicts in shared package
const BlurViewComponent = BlurView as any;

export interface GlassPanelProps {
  children: ReactNode;
  style?: ViewStyle;
  sheet?: boolean;
}

export function GlassPanel({ children, style, sheet = false }: GlassPanelProps) {
  const baseStyle: ViewStyle = {
    borderWidth: 1,
    borderColor: clinicalTokens.glass.border,
    borderRadius: clinicalTokens.radius.lg,
    shadowColor: clinicalTokens.colors.neutral.darker,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 16,
    overflow: 'hidden',
  };

  const sheetStyle: ViewStyle = sheet
    ? {
        borderTopLeftRadius: clinicalTokens.radius.lg,
        borderTopRightRadius: clinicalTokens.radius.lg,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }
    : {};

  return React.createElement(
    BlurViewComponent,
    {
      blurType: 'dark',
      blurAmount: clinicalTokens.glass.blur,
      reducedTransparencyFallbackColor: 'rgba(6, 8, 20, 0.85)',
      style: [
        baseStyle,
        sheetStyle,
        {
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
        },
        style,
      ],
    },
    children
  );
}