import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';

export type StatusVariant = 'draft' | 'pending' | 'approved' | 'rejected' | 'deidentified';
export type BadgeSize = 'sm' | 'md';

export interface StatusBadgeProps {
  status: StatusVariant;
  size?: BadgeSize;
  children?: ReactNode;
}

const statusConfig: Record<StatusVariant, { bg: string; text: string; border: string }> = {
  draft: {
    bg: 'rgba(142, 142, 147, 0.12)',
    text: '#8E8E93',
    border: 'rgba(142, 142, 147, 0.18)',
  },
  pending: {
    bg: 'rgba(255, 149, 0, 0.12)',
    text: clinicalTokens.colors.pending,
    border: 'rgba(255, 149, 0, 0.20)',
  },
  approved: {
    bg: 'rgba(52, 199, 89, 0.12)',
    text: clinicalTokens.colors.approved,
    border: 'rgba(52, 199, 89, 0.20)',
  },
  rejected: {
    bg: 'rgba(255, 59, 48, 0.12)',
    text: clinicalTokens.colors.rejected,
    border: 'rgba(255, 59, 48, 0.20)',
  },
  deidentified: {
    bg: 'rgba(88, 86, 214, 0.12)',
    text: clinicalTokens.colors.secondary.DEFAULT,
    border: 'rgba(88, 86, 214, 0.20)',
  },
};

export function StatusBadge({ status, size = 'md', children }: StatusBadgeProps) {
  const config = statusConfig[status];
  const label = children || status.charAt(0).toUpperCase() + status.slice(1);
  const dotSize = size === 'sm' ? 5 : 6;
  const fontSize = size === 'sm' ? 11 : 12;
  const px = size === 'sm' ? 6 : 8;
  const py = size === 'sm' ? 2 : 4;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: config.bg,
        borderWidth: 1,
        borderColor: config.border,
        borderRadius: 999,
        paddingHorizontal: px,
        paddingVertical: py,
      }}
    >
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: config.text,
        }}
      />
      <Text
        style={{
          color: config.text,
          fontSize,
          fontWeight: '600',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}