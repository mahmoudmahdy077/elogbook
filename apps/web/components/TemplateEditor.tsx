'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import ImpactDialog from '@/components/ImpactDialog';
import { createClient } from '@/lib/supabase/client';

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface CaseTemplate {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  updated_at: string;
}

interface TemplateEditorProps {
  tenantId: string;
  templates: CaseTemplate[];
}

export default function TemplateEditor({ tenantId, templates }: TemplateEditorProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [fieldsJson, setFieldsJson] = useState('');
  const [requiredFieldsInput, setRequiredFieldsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [impactCount, setImpactCount] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    setName('');
    setSpecialty('');
    setFieldsJson('');
    setRequiredFieldsInput('');
    setError('');
  }

  async function handleCreate() {
    setError('');

    if (!name.trim() || !specialty.trim() || !fieldsJson.trim()) {
      setError('Name, Specialty, and Fields are required.');
      return;
    }

    let parsedFields: TemplateField[];
    try {
      parsedFields = JSON.parse(fieldsJson);
      if (!Array.isArray(parsedFields)) throw new Error('Expected an array');
    } catch {
      setError('Invalid JSON for Fields. Must be an array of field objects.');
      return;
    }

    const requiredFields = requiredFieldsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setLoading(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from('case_templates').insert({
      tenant_id: tenantId,
      name: name.trim(),
      specialty: specialty.trim(),
      fields: parsedFields,
      required_fields: requiredFields,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    resetForm();
    router.refresh();
    setShowModal(false);
  }

  async function confirmDelete(id: string) {
    const supabase = createClient();
    const { count } = await supabase
      .from('case_entries')
      .select('*', { count: 'exact', head: true })
      .eq('template_id', id)
      .is('deleted_at', null);
    setDeletingId(id);
    setImpactCount(count ?? 0);
    setShowDeleteDialog(true);
  }

  async function handleDelete() {
    if (!deletingId) return;
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from('case_templates').delete().eq('id', deletingId);

    setDeleting(false);
    setShowDeleteDialog(false);
    setDeletingId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    router.refresh();
  }

  return (
    <div>
      {error && <ErrorDisplay message={error} />}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Existing Templates</h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-text-muted">No templates created yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Case templates table">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="pb-3 font-semibold text-text-muted">Name</th>
                <th className="pb-3 font-semibold text-text-muted">Specialty</th>
                <th className="pb-3 font-semibold text-text-muted">Fields</th>
                <th className="pb-3 font-semibold text-text-muted">Required</th>
                <th className="pb-3 font-semibold text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-divider">
                  <td className="py-2.5">{t.name}</td>
                  <td className="py-2.5">
                    <span className="inline-flex items-center bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
                      {t.specialty}
                    </span>
                  </td>
                  <td className="py-2.5">{t.fields?.length ?? 0}</td>
                  <td className="py-2.5">{t.required_fields?.length ?? 0}</td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      onClick={() => confirmDelete(t.id)}
                      className="rounded-full bg-red-50 text-rejected text-sm font-medium px-3 py-1.5 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Template Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
          <div className="panel p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold mb-4">Create Case Template</h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Template Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. General Surgery Log"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Specialty</label>
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  required
                  placeholder="e.g. Surgery"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Fields JSON</label>
                <textarea
                  value={fieldsJson}
                  onChange={(e) => setFieldsJson(e.target.value)}
                  required
                  rows={6}
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1">Required Fields (comma-separated)</label>
                <input
                  type="text"
                  value={requiredFieldsInput}
                  onChange={(e) => setRequiredFieldsInput(e.target.value)}
                  placeholder="Diagnosis, Procedure"
                  className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setShowModal(false); resetForm(); }}
                className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={loading}
                className={`rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium transition-opacity ${
                  loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
              >
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}

      <ImpactDialog
        isOpen={showDeleteDialog}
        title="Delete Template"
        message="This will permanently delete this template."
        impact={impactCount > 0 ? `${impactCount} case entr${impactCount === 1 ? 'y' : 'ies'} use${impactCount === 1 ? 's' : ''} this template.` : undefined}
        severity="danger"
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => { setShowDeleteDialog(false); setDeletingId(null); }}
      />
    </div>
  );
}
