import { View, Text, ViewStyle, TextStyle, Platform } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';

export type StatusVariant = 'draft' | 'pending' | 'approved' | 'rejected' | 'deidentified';
export type BadgeSize = 'sm' | 'md';

export interface StatusBadgeProps {
  status: StatusVariant;
  size?: BadgeSize;
  children?: ReactNode;
  style?: ViewStyle;
}

const statusColors: Record<StatusVariant, { bg: string; text: string; glow: string; dot: string; border: string }> = {
  draft: {
    bg: 'rgba(148, 163, 184, 0.15)',
    text: clinicalTokens.colors.text.muted,
    glow: clinicalTokens.shadows.glow(clinicalTokens.colors.text.muted),
    dot: clinicalTokens.colors.text.muted,
    border: 'rgba(148, 163, 184, 0.2)',
  },
  pending: {
    bg: 'rgba(252, 211, 77, 0.15)',
    text: clinicalTokens.colors.pending,
    glow: clinicalTokens.shadows.pending,
    dot: clinicalTokens.colors.pending,
    border: 'rgba(252, 211, 77, 0.3)',
  },
  approved: {
    bg: 'rgba(16, 185, 129, 0.15)',
    text: clinicalTokens.colors.approved,
    glow: clinicalTokens.shadows.approved,
    dot: clinicalTokens.colors.approved,
    border: 'rgba(16, 185, 129, 0.3)',
  },
  rejected: {
    bg: 'rgba(239, 68, 68, 0.15)',
    text: clinicalTokens.colors.rejected,
    glow: clinicalTokens.shadows.rejected,
    dot: clinicalTokens.colors.rejected,
    border: 'rgba(239, 68, 68, 0.3)',
  },
  deidentified: {
    bg: 'rgba(99, 102, 241, 0.15)',
    text: clinicalTokens.colors.secondary.DEFAULT,
    glow: clinicalTokens.shadows.glow(clinicalTokens.colors.secondary.glow),
    dot: clinicalTokens.colors.secondary.DEFAULT,
    border: 'rgba(99, 102, 241, 0.3)',
  },
};

const sizeStyles: Record<BadgeSize, { container: ViewStyle; dotSize: number; gap: number; fontSize: number }> = {
  sm: { container: { paddingHorizontal: 8, paddingVertical: 4 }, dotSize: 6, gap: 4, fontSize: 11 },
  md: { container: { paddingHorizontal: 12, paddingVertical: 6 }, dotSize: 8, gap: 6, fontSize: 13 },
};

export function StatusBadge({ status, size = 'md', children, style }: StatusBadgeProps) {
  const config = statusColors[status];
  const sizing = sizeStyles[size];
  const label = children || status.charAt(0).toUpperCase() + status.slice(1);

  const containerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sizing.gap,
    borderRadius: clinicalTokens.radius.full,
    backgroundColor: config.bg,
    borderWidth: 1,
    borderColor: config.border,
    ...sizing.container,
    ...style,
  };

  if (Platform.OS === 'ios' && config.glow) {
    containerStyle.shadowColor = config.glow;
    containerStyle.shadowOffset = { width: 0, height: 0 };
    containerStyle.shadowRadius = 6;
    containerStyle.shadowOpacity = 0.5;
  }

  const dotStyle: ViewStyle = {
    width: sizing.dotSize,
    height: sizing.dotSize,
    borderRadius: sizing.dotSize / 2,
    backgroundColor: config.dot,
  };

  const textStyle: TextStyle = {
    fontSize: sizing.fontSize,
    fontWeight: '600',
    color: config.text,
    fontFamily: clinicalTokens.fonts.body,
  };

  return (
    <View style={containerStyle}>
      <View style={dotStyle} />
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}