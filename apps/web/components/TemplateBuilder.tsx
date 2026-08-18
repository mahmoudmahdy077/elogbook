'use client';

import { useState, useCallback } from 'react';
import FieldList from './FieldList';
import TemplatePreview from './TemplatePreview';
import type { TemplateField } from '@elogbook/shared';

interface TemplateBuilderProps {
  initialTemplate?: {
    id?: string;
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  };
  specialties: string[];
  onSave: (template: {
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

export default function TemplateBuilder({
  initialTemplate,
  specialties,
  onSave,
  onCancel,
}: TemplateBuilderProps) {
  const [name, setName] = useState(initialTemplate?.name ?? '');
  const [specialty, setSpecialty] = useState(initialTemplate?.specialty ?? '');
  const [fields, setFields] = useState<TemplateField[]>(
    initialTemplate?.fields ?? []
  );
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredFields = fields
    .filter(f => f.required)
    .map(f => f.key);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Template name is required');
      return;
    }
    if (!specialty) {
      setError('Specialty is required');
      return;
    }
    if (fields.length === 0) {
      setError('At least one field is required');
      return;
    }

    const keys = fields.map(f => f.key);
    if (keys.length !== new Set(keys).size) {
      setError('Duplicate field keys are not allowed');
      return;
    }

    for (const field of fields) {
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        setError(`Field "${field.label}" is a dropdown but has no options`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ name, specialty, fields, required_fields: requiredFields });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [name, specialty, fields, requiredFields, onSave]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs mb-1 text-text-muted">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
            placeholder="e.g. General Surgery Log"
          />
        </div>
        <div>
          <label className="block text-xs mb-1 text-text-muted">Specialty</label>
          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
          >
            <option value="">Select specialty</option>
            {specialties.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Fields ({fields.length})</h3>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="text-sm text-primary hover:underline"
          >
            Preview Template
          </button>
        </div>
        <FieldList fields={fields} onChange={setFields} />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-neutral-dark/50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : initialTemplate?.id ? 'Update Template' : 'Create Template'}
        </button>
      </div>

      {showPreview && (
        <TemplatePreview
          fields={fields}
          templateName={name || 'Untitled Template'}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
