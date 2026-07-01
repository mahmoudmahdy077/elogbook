import type { HTMLAttributes, ReactNode } from 'react';

export interface FormDividerProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
}

export function FormDivider({ label, className = '' }: FormDividerProps) {
  return (
    <div className={`flex items-center gap-3 text-xs text-text-muted ${className}`}>
      <hr className="flex-1 border-border" />
      <span className="uppercase tracking-wide whitespace-nowrap">{label}</span>
      <hr className="flex-1 border-border" />
    </div>
  );
}
