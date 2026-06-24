'use client';

import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode, CSSProperties } from 'react';

export type ClinicalTextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ClinicalTextProps {
  children: ReactNode;
  size?: ClinicalTextSize;
  className?: string;
  style?: CSSProperties;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  color?: 'primary' | 'secondary' | 'muted' | 'onPrimary';
}

const sizeStyles: Record<ClinicalTextSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

const colorStyles = {
  primary: clinicalTokens.colors.text.primary,
  secondary: clinicalTokens.colors.text.secondary,
  muted: clinicalTokens.colors.text.muted,
  onPrimary: clinicalTokens.colors.text.onPrimary,
};

export function ClinicalText({
  children,
  size = 'md',
  className = '',
  style,
  weight = 'normal',
  color = 'primary',
}: ClinicalTextProps) {
  return (
    <span
      className={`
        font-mono tabular-nums
        ${sizeStyles[size]}
        ${className}
      `}
      style={{
        fontFamily: clinicalTokens.fonts.mono,
        fontWeight: weight === 'normal' ? 400 : weight === 'medium' ? 500 : weight === 'semibold' ? 600 : 700,
        color: colorStyles[color],
        ...style,
      }}
    >
      {children}
    </span>
  );
}