'use client';

/* ===================================================================
 * ReflectionsJournal — reflective-practice module (P0-2, must-have #8).
 * Structured reflections: category, free text, optional shared flag
 * that exposes the entry to program leadership. Apple Health light
 * aesthetic: flat surfaces, zero shadows, #007AFF accent.
 * =================================================================== */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { REFLECTION_TYPES, reflectionCreateSchema } from '@elogbook/shared';
import ErrorDisplay from '@/components/ErrorDisplay';
import { createClient } from '@/lib/supabase/client';

export interface ReflectionRow {
  id: string;
  author_id: string;
  case_id: string | null;
  reflection_type: string;
  title: string;
  body: string;
  prompt: string | null;
  shared: boolean;
  created_at: string;
}

interface ReflectionFormValue {
  id: string;
  author_id: string;
  reflection_type: string;
  title: string;
  body: string;
  shared: boolean;
}

interface ReflectionsJournalProps {
  tenantId: string;
  authorId: string;
  isLeadership: boolean;
  /** Pre-fetched on the server: own reflections + (leadership) shared ones. */
  reflections: ReflectionRow[];
}

/* Pure helpers (unit-tested) ----------------------------------------- */

export function wordCount(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** 'procedural' -> 'Procedural' */
export function typeLabel(reflectionType: string): string {
  return reflectionType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatReflectionDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function splitReflections(rows: ReflectionRow[], viewerId: string): {
  mine: ReflectionRow[];
  shared: ReflectionRow[];
} {
  const mine: ReflectionRow[] = [];
  const shared: ReflectionRow[] = [];
  for (const row of rows) {
    if (row.author_id === viewerId) mine.push(row);
    else shared.push(row);
  }
  return { mine, shared };
}

export function previewText(body: string, maxChars = 200): string {
  if (body.length <= maxChars) return body;
  const cut = body.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars).trimEnd()}…`;
}

/* Form --------------------------------------------------------------- */

function ReflectionForm({
  tenantId,
  authorId,
  initial,
  onClose,
  onDeleted,
}: {
  tenantId: string;
  authorId: string;
  initial: ReflectionFormValue | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const isEditMode = !!initial;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [reflectionType, setReflectionType] = useState(
    initial?.reflection_type ?? 'clinical'
  );
  const [body, setBody] = useState(initial?.body ?? '');
  const [shared, setShared] = useState(initial?.shared ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) {
      setTitle(initial.title);
      setReflectionType(initial.reflection_type);
      setBody(initial.body);
      setShared(initial.shared);
    }
  }, [initial]);

  async function handleSubmit() {
    setError('');

    const result = reflectionCreateSchema.safeParse({
      title,
      reflection_type: reflectionType,
      body,
      shared,
    });
    if (!result.success) {
      setError(result.error.issues.map((e) => e.message).join(', '));
      return;
    }

    setLoading(true);
    const supabase = createClient();

    if (isEditMode && initial) {
      const { error: updateError } = await supabase
        .from('reflections')
        .update({
          title: result.data.title,
          reflection_type: result.data.reflection_type,
          body: result.data.body,
          shared: result.data.shared,
        })
        .eq('id', initial.id);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from('reflections')
        .insert({
          tenant_id: tenantId,
          author_id: authorId,
          title: result.data.title,
          reflection_type: result.data.reflection_type,
          body: result.data.body,
          shared: result.data.shared,
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    router.refresh();
    onClose();
  }

  async function handleDelete() {
    if (!initial) return;
    setError('');
    setLoading(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('reflections')
      .delete()
      .eq('id', initial.id);

    if (deleteError) {
      setError(deleteError.message);
      setLoading(false);
      return;
    }

    onDeleted(initial.id);
    setLoading(false);
    router.refresh();
    onClose();
  }

  return (
    <button
      type="button"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="panel p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEditMode ? 'Edit reflection' : 'New reflection'}
      >
        <h3 className="text-lg font-semibold mb-4">
          {isEditMode ? 'Edit Reflection' : 'New Reflection'}
        </h3>

        {error && <ErrorDisplay message={error} />}

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text-secondary block mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Difficult fracture reduction"
              className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-secondary block mb-1">
              Category
            </label>
            <select
              value={reflectionType}
              onChange={(e) => setReflectionType(e.target.value)}
              className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
              aria-label="Reflection category"
            >
              {REFLECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-text-secondary block mb-1">
              What happened, what went well, what you would do differently
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={8}
              placeholder="Reflect on the case: context, decisions, outcomes, learning points..."
              className="rounded-xl bg-neutral-dark border border-border p-3 w-full text-sm"
            />
            <p className="text-xs text-text-muted mt-1">
              {wordCount(body)} words · {body.length}/10000 characters
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="rounded"
            />
            Share with program leadership
          </label>

          <div className="flex items-center justify-between pt-2">
            <div>
              {isEditMode && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="rounded-full border border-border text-sm font-medium px-3 py-1.5 text-red-600 hover:bg-neutral-dark transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border text-sm font-medium px-4 py-2 text-text-secondary hover:bg-neutral-dark transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="rounded-full bg-primary text-text-on-primary px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Saving…' : isEditMode ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* Card --------------------------------------------------------------- */

function ReflectionCard({
  row,
  showAuthor,
  authorName,
  onEdit,
}: {
  row: ReflectionRow;
  showAuthor: boolean;
  authorName?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="bg-surface-solid rounded-2xl border border-border p-5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-text-primary tracking-[-0.02em] font-sans">
          {row.title}
        </h3>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold text-text-muted uppercase tracking-wider bg-black/5">
            {typeLabel(row.reflection_type)}
          </span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-border text-[0.65rem] font-semibold uppercase tracking-wider px-2.5 py-1 text-text-secondary hover:bg-neutral-dark transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted mb-3">
        {formatReflectionDate(row.created_at)} · {wordCount(row.body)}{' '}
        {wordCount(row.body) === 1 ? 'word' : 'words'}
        {row.shared ? ' · Shared with leadership' : ''}
        {showAuthor && authorName ? ` · ${authorName}` : ''}
      </p>
      <p className="text-sm text-text-primary/90 whitespace-pre-line">
        {previewText(row.body)}
      </p>
    </div>
  );
}

/* Main ---------------------------------------------------------------- */

export default function ReflectionsJournal({
  tenantId,
  authorId,
  isLeadership,
  reflections,
}: ReflectionsJournalProps) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ReflectionFormValue | null>(null);
  const { mine, shared } = splitReflections(reflections, authorId);

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex justify-between items-center gap-3">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans">
            Reflections
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1 font-normal">
            Your reflective practice journal — private unless you choose to share
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowModal(true);
          }}
          className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          New Reflection
        </button>
      </div>

      {/* My reflections */}
      <section aria-label="My reflections">
        {mine.length === 0 ? (
          <div className="bg-surface-solid rounded-2xl border border-border p-8 text-center">
            <p className="text-sm text-text-muted">
              No reflections yet — your first entry appears here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {mine.map((row) => (
              <ReflectionCard
                key={row.id}
                row={row}
                showAuthor={false}
                onEdit={() => {
                  setEditing({
                    id: row.id,
                    author_id: row.author_id,
                    reflection_type: row.reflection_type,
                    title: row.title,
                    body: row.body,
                    shared: row.shared,
                  });
                  setShowModal(true);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Shared with leadership (director/admin view) */}
      {isLeadership && (
        <section aria-label="Shared with leadership">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Shared with leadership
          </h2>
          {shared.length === 0 ? (
            <div className="bg-surface-solid rounded-2xl border border-border p-6 text-center">
              <p className="text-sm text-text-muted">
                Nothing shared yet — residents appear here when they opt in.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {shared.map((row) => (
                <ReflectionCard
                  key={row.id}
                  row={row}
                  showAuthor
                  authorName={
                    (row as ReflectionRow & { profiles?: { full_name?: string } })
                      .profiles?.full_name
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showModal && (
        <ReflectionForm
          tenantId={tenantId}
          authorId={authorId}
          initial={editing}
          onClose={() => setShowModal(false)}
          onDeleted={() => {
            /* list refreshes via router.refresh() */
          }}
        />
      )}
    </div>
  );
}
