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

const statusConfig: Record<StatusVariant, { bg: string; text: string; glow: string; border: string }> = {
  draft: {
    bg: 'rgba(148, 163, 184, 0.15)',
    text: clinicalTokens.colors.text.muted,
    glow: clinicalTokens.shadows.glow(clinicalTokens.colors.text.muted),
    border: 'rgba(148, 163, 184, 0.3)',
  },
  pending: {
    bg: 'rgba(252, 211, 77, 0.15)',
    text: clinicalTokens.colors.pending,
    glow: clinicalTokens.shadows.pending,
    border: 'rgba(252, 211, 77, 0.3)',
  },
  approved: {
    bg: 'rgba(16, 185, 129, 0.15)',
    text: clinicalTokens.colors.approved,
    glow: clinicalTokens.shadows.approved,
    border: 'rgba(16, 185, 129, 0.3)',
  },
  rejected: {
    bg: 'rgba(239, 68, 68, 0.15)',
    text: clinicalTokens.colors.rejected,
    glow: clinicalTokens.shadows.rejected,
    border: 'rgba(239, 68, 68, 0.3)',
  },
  deidentified: {
    bg: 'rgba(99, 102, 241, 0.15)',
    text: clinicalTokens.colors.secondary.DEFAULT,
    glow: clinicalTokens.shadows.glow(clinicalTokens.colors.secondary.glow),
    border: 'rgba(99, 102, 241, 0.3)',
  },
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-3 py-1 text-sm gap-1.5',
};

export function StatusBadge({ status, size = 'md', children, className = '', style }: StatusBadgeProps) {
  const config = statusConfig[status];
  const label = children || status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`
        inline-flex items-center font-medium
        ${sizeStyles[size]}
        ${className}
      `}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
        borderRadius: clinicalTokens.radius.full,
        boxShadow: config.glow,
        ...style,
      }}
    >
      <span
        style={{
          width: size === 'sm' ? 6 : 8,
          height: size === 'sm' ? 6 : 8,
          borderRadius: '50%',
          backgroundColor: config.text,
          boxShadow: config.glow,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}