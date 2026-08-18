'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import TemplateBuilder from '@/components/TemplateBuilder';
import TemplateImportExport from '@/components/TemplateImportExport';
import type { TemplateField } from '@elogbook/shared';

interface Template {
  id: string;
  name: string;
  specialty: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  is_global: boolean;
  usage_count: number;
}

const SPECIALTIES = [
  'Surgery', 'Internal Medicine', 'Pediatrics', 'Emergency',
  'Radiology', 'Cardiology', 'Neurology', 'Orthopedics',
  'Psychiatry', 'Obstetrics', 'Dermatology', 'Ophthalmology',
];

export default function TemplatesPage() {
  const params = useParams();
  const tenantSlug = params.tenant as string;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenantSlug}/templates`);
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleSave = useCallback(async (template: {
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  }) => {
    const url = editing?.id
      ? `/api/${tenantSlug}/templates/${editing.id}`
      : `/api/${tenantSlug}/templates`;
    const method = editing?.id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save');
    }

    setEditing(null);
    setCreating(false);
    loadTemplates();
  }, [editing, tenantSlug, loadTemplates]);

  const handleDuplicate = useCallback(async (template: Template) => {
    const res = await fetch(`/api/${tenantSlug}/templates/${template.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${template.name} (Copy)` }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to duplicate');
      return;
    }

    loadTemplates();
  }, [tenantSlug, loadTemplates]);

  const handleDelete = useCallback(async (template: Template) => {
    if (!confirm(`Delete "${template.name}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/${tenantSlug}/templates/${template.id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to delete');
      return;
    }

    loadTemplates();
  }, [tenantSlug, loadTemplates]);

  if (loading) return <div className="p-6">Loading templates...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Case Templates</h1>
        <div className="flex gap-2">
          <TemplateImportExport
            tenantSlug={tenantSlug}
            onImportComplete={loadTemplates}
          />
          {!creating && !editing && (
            <button
              onClick={() => setCreating(true)}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
            >
              Create Template
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {(creating || editing) && (
        <div className="panel p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editing ? 'Edit Template' : 'Create New Template'}
          </h2>
          <TemplateBuilder
            initialTemplate={editing ?? undefined}
            specialties={SPECIALTIES}
            onSave={handleSave}
            onCancel={() => { setEditing(null); setCreating(false); }}
          />
        </div>
      )}

      <div className="space-y-3">
        {templates.length === 0 && (
          <p className="text-text-muted text-sm">No templates yet. Create one to get started.</p>
        )}

        {templates.map(template => (
          <div
            key={template.id}
            className="panel p-4 flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{template.name}</span>
                {template.is_global && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Global</span>
                )}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {template.specialty} · {template.fields.length} fields · {template.required_fields.length} required · {template.usage_count} uses
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TemplateImportExport
                templateId={template.id}
                templateName={template.name}
                tenantSlug={tenantSlug}
                onImportComplete={loadTemplates}
              />
              {!template.is_global && (
                <>
                  <button
                    onClick={() => setEditing(template)}
                    className="px-3 py-1.5 rounded border border-border text-xs hover:bg-neutral-dark/50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDuplicate(template)}
                    className="px-3 py-1.5 rounded border border-border text-xs hover:bg-neutral-dark/50"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => handleDelete(template)}
                    className="px-3 py-1.5 rounded border border-danger/30 text-danger text-xs hover:bg-danger/10"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
