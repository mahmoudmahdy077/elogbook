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