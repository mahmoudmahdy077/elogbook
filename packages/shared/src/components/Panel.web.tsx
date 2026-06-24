'use client';

import { clinicalTokens } from '../constants/design-tokens';
import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hoverable?: boolean;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ children, className = '', hoverable = false, onClick, style, ...props }, ref) => {
    const baseStyles = 'bg-neutral-darker border border-border-DEFAULT rounded-lg';
    const hoverStyles = hoverable ? 'transition-shadow duration-200 hover:shadow-[0_0_30px_rgba(6,8,20,0.4)] cursor-pointer' : '';
    const pressStyles = onClick ? 'active:scale-[0.98] active:transition-transform active:duration-100' : '';

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${hoverStyles} ${pressStyles} ${className}`}
        onClick={onClick}
        style={{
          backgroundColor: clinicalTokens.colors.neutral.darker,
          borderColor: clinicalTokens.colors.border.DEFAULT,
          borderWidth: 1,
          borderRadius: clinicalTokens.radius.lg,
          padding: clinicalTokens.spacing.md,
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Panel.displayName = 'Panel';