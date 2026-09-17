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
    text: clinicalTokens.colors.status.text.draft, // #48484A — 4.55-8.08:1 on this bg (raw #6D6D73 was 3.98 worst-case)
    border: 'rgba(142, 142, 147, 0.18)',
  },
  pending: {
    bg: 'rgba(163, 75, 0, 0.10)',
    text: clinicalTokens.colors.status.text.warning,
    border: clinicalTokens.colors.status.border.warning,
  },
  approved: {
    bg: 'rgba(29, 122, 54, 0.10)',
    text: clinicalTokens.colors.status.text.success,
    border: clinicalTokens.colors.status.border.success,
  },
  rejected: {
    bg: 'rgba(215, 0, 21, 0.10)',
    text: clinicalTokens.colors.status.text.danger,
    border: clinicalTokens.colors.status.border.danger,
  },
  deidentified: {
    bg: 'rgba(88, 86, 214, 0.12)',
    text: clinicalTokens.colors.deidentified.DEFAULT, // #4442C9 — ≥5.48:1 on this bg (raw #5856D6 was 4.31 worst-case)
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