'use client';

import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode, InputHTMLAttributes } from 'react';

export interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  rightElement?: ReactNode;
  inputClassName?: string;
}

export function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  className = '',
  inputClassName = '',
  rightElement,
  ...props
}: FormFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-sm font-medium mb-1.5 text-text-primary"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors ${rightElement ? 'pr-11' : ''} ${inputClassName}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
            {rightElement}
          </div>
        )}
      </div>
    </div>
  );
}
