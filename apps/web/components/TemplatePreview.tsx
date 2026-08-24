'use client';

import { useState } from 'react';
import type { TemplateField } from '@elogbook/shared';

interface TemplatePreviewProps {
  fields: TemplateField[];
  templateName: string;
  onClose: () => void;
}

export default function TemplatePreview({ fields, templateName, onClose }: TemplatePreviewProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};

    for (const field of fields) {
      const value = values[field.key];

      if (field.required && (value === undefined || value === '' || value === null)) {
        newErrors[field.key] = `${field.label} is required`;
        continue;
      }

      if (value === undefined || value === '' || value === null) continue;

      const v = field.validation;
      if (!v) continue;

      if (field.type === 'text' || field.type === 'textarea') {
        const str = String(value);
        if (v.minLength && str.length < v.minLength) {
          newErrors[field.key] = `Minimum ${v.minLength} characters required`;
        }
        if (v.maxLength && str.length > v.maxLength) {
          newErrors[field.key] = `Maximum ${v.maxLength} characters allowed`;
        }
        if (v.pattern) {
          try {
            const regex = new RegExp(v.pattern);
            if (!regex.test(str)) {
              newErrors[field.key] = v.patternMessage || 'Invalid format';
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }

      if (field.type === 'number') {
        const num = Number(value);
        if (v.min !== undefined && num < v.min) {
          newErrors[field.key] = `Minimum value is ${v.min}`;
        }
        if (v.max !== undefined && num > v.max) {
          newErrors[field.key] = `Maximum value is ${v.max}`;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const renderField = (field: TemplateField) => {
    const value = values[field.key];
    const error = errors[field.key];

    const baseInputClass = `w-full px-3 py-2 rounded-lg bg-neutral-dark border text-sm ${
      error ? 'border-danger' : 'border-border'
    }`;

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
            placeholder={field.description}
          />
        );
      case 'textarea':
        return (
          <textarea
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
            rows={3}
            placeholder={field.description}
          />
        );
      case 'select':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
          >
            <option value="">Select...</option>
            {(field.options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case 'number':
        return (
          <input
            type="number"
            value={value !== undefined ? String(value) : ''}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value ? Number(e.target.value) : '' })}
            className={baseInputClass}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
          />
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm">{field.label}</span>
          </label>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-panel p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Preview: {templateName}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>

        <div className="space-y-4">
          {fields.map(field => (
            <div key={field.key}>
              {field.type !== 'checkbox' && (
                <label className="block text-xs mb-1 text-text-muted">
                  {field.label}
                  {field.required && <span className="text-danger ml-1">*</span>}
                </label>
              )}
              {renderField(field)}
              {field.description && field.type !== 'checkbox' && (
                <p className="text-xs text-text-muted mt-1">{field.description}</p>
              )}
              {errors[field.key] && (
                <p className="text-xs text-danger mt-1">{errors[field.key]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={validate}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-neutral-dark/50"
          >
            Validate
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
