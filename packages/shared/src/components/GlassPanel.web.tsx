'use client';

import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode, CSSProperties } from 'react';

export interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  sheet?: boolean;
}

export function GlassPanel({ children, className = '', style, sheet = false }: GlassPanelProps) {
  const baseStyles = `
    backdrop-blur-[12px]
    bg-white/5
    border border-white/5
    rounded-2xl
    ${clinicalTokens.glass.shadow}
  `;
  const sheetStyles = sheet ? 'rounded-t-2xl border-t-0 border-b-0 border-l-white/5 border-r-white/5' : '';

  return (
    <div
      className={`${baseStyles} ${sheetStyles} ${className}`}
      style={{
        backdropFilter: `blur(${clinicalTokens.glass.blur}px)`,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        border: `1px solid ${clinicalTokens.glass.border}`,
        borderRadius: clinicalTokens.radius.lg,
        boxShadow: clinicalTokens.glass.shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}