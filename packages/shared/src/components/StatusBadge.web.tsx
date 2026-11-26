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

/**
 * Status colours come from CSS custom properties, not fixed hex, so the badge
 * follows the light/dark theme. The previous inline hex values (#48484A,
 * #186B2E, …) could not be overridden by `.dark` and rendered at ~1.4:1 on the
 * dark surface.
 */
const statusConfig: Record<StatusVariant, { fg: string; tint: number }> = {
  draft: { fg: 'var(--color-text-secondary)', tint: 12 },
  pending: { fg: 'var(--color-fg-warning)', tint: 10 },
  approved: { fg: 'var(--color-fg-success)', tint: 10 },
  rejected: { fg: 'var(--color-fg-danger)', tint: 10 },
  deidentified: { fg: 'var(--color-fg-primary)', tint: 12 },
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[0.65rem] gap-1',
  md: 'px-2.5 py-1 text-[0.7rem] gap-1',
};

export function StatusBadge({ status, size = 'md', children, className = '', style }: StatusBadgeProps) {
  const config = statusConfig[status];
  const label = children || status.charAt(0).toUpperCase() + status.slice(1);
  const background = `color-mix(in srgb, ${config.fg} ${config.tint}%, transparent)`;
  const border = `1px solid color-mix(in srgb, ${config.fg} 22%, transparent)`;

  return (
    <span
      className={`
        inline-flex items-center font-semibold tracking-wide
        ${sizeStyles[size]}
        ${className}
      `}
      style={{
        backgroundColor: background,
        color: config.fg,
        border,
        borderRadius: clinicalTokens.radius.full,
        ...style,
      }}
    >
      <span
        style={{
          width: size === 'sm' ? 5 : 6,
          height: size === 'sm' ? 5 : 6,
          borderRadius: '50%',
          backgroundColor: config.fg,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
