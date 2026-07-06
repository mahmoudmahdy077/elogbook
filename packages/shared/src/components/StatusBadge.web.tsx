'use client';

import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode, CSSProperties } from 'react';

export type StatusVariant = 'draft' | 'pending' | 'approved' | 'rejected' | 'deidentified';
export type BadgeSize = 'sm' | 'md';

export interface StatusBadgeProps {
  status: StatusVariant;
  size?: BadgeSize;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
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

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[0.65rem] gap-1',
  md: 'px-2.5 py-1 text-[0.7rem] gap-1',
};

export function StatusBadge({ status, size = 'md', children, className = '', style }: StatusBadgeProps) {
  const config = statusConfig[status];
  const label = children || status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`
        inline-flex items-center font-semibold tracking-wide
        ${sizeStyles[size]}
        ${className}
      `}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
        borderRadius: clinicalTokens.radius.full,
        ...style,
      }}
    >
      <span
        style={{
          width: size === 'sm' ? 5 : 6,
          height: size === 'sm' ? 5 : 6,
          borderRadius: '50%',
          backgroundColor: config.text,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}