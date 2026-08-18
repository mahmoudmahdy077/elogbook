'use client';

import { useState } from 'react';
import type { TemplateField } from '@elogbook/shared';

interface FieldEditorProps {
  field: TemplateField;
  index: number;
  onUpdate: (index: number, field: TemplateField) => void;
  onRemove: (index: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
] as const;

export default function FieldEditor({
  field,
  index,
  onUpdate,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: FieldEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const update = (partial: Partial<TemplateField>) => {
    onUpdate(index, { ...field, ...partial });
  };

  const generateKey = (label: string) => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  };

  return (
    <div
      className={`p-4 rounded-lg border transition-opacity ${isDragging ? 'opacity-50' : ''} ${field.required ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="cursor-grab text-text-muted hover:text-text-primary">⠿</span>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 text-left font-medium text-sm"
        >
          {field.label || 'New Field'}
        </button>
        {field.required && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Required</span>
        )}
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-danger hover:text-danger/80 text-sm"
        >
          Remove
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Label</label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => {
                  const label = e.target.value;
                  update({ label, key: field.key || generateKey(label) });
                }}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                placeholder="e.g. Procedure Name"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 text-text-muted">Key</label>
              <input
                type="text"
                value={field.key}
                onChange={(e) => update({ key: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm font-mono"
                placeholder="procedure_name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Type</label>
              <select
                value={field.type}
                onChange={(e) => update({ type: e.target.value as TemplateField['type'] })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required ?? false}
                  onChange={(e) => update({ required: e.target.checked })}
                  className="rounded border-border"
                />
                <span className="text-sm">Required</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1 text-text-muted">Description (help text)</label>
            <input
              type="text"
              value={field.description ?? ''}
              onChange={(e) => update({ description: e.target.value || undefined })}
              className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
              placeholder="Optional help text shown below the field"
            />
          </div>

          {field.type === 'select' && (
            <div>
              <label className="block text-xs mb-1 text-text-muted">Options (one per line)</label>
              <textarea
                value={(field.options ?? []).join('\n')}
                onChange={(e) => update({ options: e.target.value.split('\n').filter(Boolean) })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                rows={3}
                placeholder={'Option 1\nOption 2\nOption 3'}
              />
            </div>
          )}

          {(field.type === 'text' || field.type === 'textarea') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Min Length</label>
                <input
                  type="number"
                  value={field.validation?.minLength ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, minLength: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Max Length</label>
                <input
                  type="number"
                  value={field.validation?.maxLength ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, maxLength: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  min={0}
                />
              </div>
            </div>
          )}

          {field.type === 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Min Value</label>
                <input
                  type="number"
                  value={field.validation?.min ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, min: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Max Value</label>
                <input
                  type="number"
                  value={field.validation?.max ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, max: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                />
              </div>
            </div>
          )}

          {field.type === 'text' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Pattern (regex)</label>
                <input
                  type="text"
                  value={field.validation?.pattern ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, pattern: e.target.value || undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm font-mono"
                  placeholder="^[A-Z]{2}\\d{4}$"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Pattern Error Message</label>
                <input
                  type="text"
                  value={field.validation?.patternMessage ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, patternMessage: e.target.value || undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  placeholder="Invalid format"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
