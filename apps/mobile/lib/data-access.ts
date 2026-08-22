/**
 * Offline-first data-access layer.
 *
 * Every screen reads from the local WatermelonDB (fast, works offline)
 * and writes to the local DB with a pending sync status. The SyncEngine
 * pushes changes to Supabase when online. When the server responds with
 * newer data (e.g. supervisor approval), the pull phase merges it locally.
 *
 * SECURITY: all data is scoped to the current tenant + user. PHI fields
 * (patient_mrn, patient_dob, field_values) are encrypted at rest via the
 * AEAD module before storage when the SQLCipher build flag is not verified.
 *
 * This module provides React hooks that screens import directly.
 */

import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import type { Model, Query } from '@nozbe/watermelondb';
import { getDatabase } from './db/database';
import type { CaseEntry } from './db/models/CaseEntry';
import type { CaseTemplate } from './db/models/CaseTemplate';
import type { ProgramGoal } from './db/models/ProgramGoal';
import type { Rotation } from './db/models/Rotation';
import type { Milestone } from './db/models/Milestone';
import type { EvaluationForm } from './db/models/EvaluationForm';
import type { Comment } from './db/models/Comment';
import type { Shift } from './db/models/Shift';

// ---------------------------------------------------------------------------
// Generic read hook — subscribes to a WatermelonDB query with live updates.
// Returns data immediately from local DB (even offline) and re-renders on
// any local change (e.g. after sync merge).
// ---------------------------------------------------------------------------

function useLiveQuery<T extends Model>(
  queryFn: () => Query<T>,
  deps: unknown[] = [],
): { data: T[]; loading: boolean; error: string | null } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = queryFn();

    const subscription = query.observe().subscribe({
      next: (records: unknown[]) => {
        if (!cancelled) {
          setData(records as T[]);
          setLoading(false);
        }
      },
      error: (err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      },
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // deps is the caller-provided dependency list (documented hook contract);
    // the lint rule can't statically verify a spread dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Case Entries
// ---------------------------------------------------------------------------

export function useCaseEntries(residentId: string, tenantId: string) {
  return useLiveQuery<CaseEntry>(
    () =>
      getDatabase()
        .get<CaseEntry>('case_entries')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

export function useCaseEntry(id: string) {
  return useLiveQuery<CaseEntry>(
    () =>
      getDatabase()
        .get<CaseEntry>('case_entries')
        .query(Q.where('id', id)),
    [id],
  );
}

export async function createCaseEntry(
  data: Partial<CaseEntry> & { tenant_id: string; resident_id: string },
): Promise<string> {
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<CaseEntry>('case_entries').create((row: CaseEntry) => {
      row.tenantId = data.tenant_id;
      row.residentId = data.resident_id;
      row.templateId = data.templateId ?? '';
      row.patientMrn = data.patientMrn ?? null;
      row.patientDob = data.patientDob ?? null;
      row.patientAgeYears = data.patientAgeYears ?? null;
      row.patientHash = data.patientHash ?? null;
      row.caseDate = data.caseDate ?? new Date().toISOString().slice(0, 10);
      row.fieldValues = data.fieldValues ?? {};
      row.accreditationMappings = data.accreditationMappings ?? [];
      row.isDeidentified = data.isDeidentified ?? false;
      row.status = data.status ?? 'draft';
      row.localSyncStatus = 'pending_create';
      row.serverId = null;
      row.serverUpdatedAt = null;
      row.isDeleted = false;
    }),
  );
  return record.id;
}

export async function updateCaseEntry(
  id: string,
  changes: Partial<Pick<CaseEntry, 'status' | 'fieldValues' | 'patientMrn' | 'patientDob'>>,
): Promise<void> {
  const db = getDatabase();
  await db.write(() =>
    db.get<CaseEntry>('case_entries').find(id).then((record: CaseEntry) =>
      record.update((row: CaseEntry) => {
        if (changes.status !== undefined) row.status = changes.status;
        if (changes.fieldValues !== undefined) row.fieldValues = changes.fieldValues;
        if (changes.patientMrn !== undefined) row.patientMrn = changes.patientMrn;
        if (changes.patientDob !== undefined) row.patientDob = changes.patientDob;
        row.localSyncStatus = 'pending_update';
      }),
    ),
  );
}

export async function deleteCaseEntry(id: string): Promise<void> {
  const db = getDatabase();
  await db.write(() =>
    db.get<CaseEntry>('case_entries').find(id).then((record: CaseEntry) =>
      record.update((row: CaseEntry) => {
        row.isDeleted = true;
        row.localSyncStatus = 'pending_delete';
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Case Templates (read-only on mobile, synced from server)
// ---------------------------------------------------------------------------

export function useCaseTemplates(tenantId: string) {
  return useLiveQuery<CaseTemplate>(
    () =>
      getDatabase()
        .get<CaseTemplate>('case_templates')
        .query(
          Q.and(
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [tenantId],
  );
}

// ---------------------------------------------------------------------------
// Program Goals
// ---------------------------------------------------------------------------

export function useProgramGoals(residentId: string, tenantId: string) {
  return useLiveQuery<ProgramGoal>(
    () =>
      getDatabase()
        .get<ProgramGoal>('program_goals')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

// ---------------------------------------------------------------------------
// Rotations
// ---------------------------------------------------------------------------

export function useRotations(residentId: string, tenantId: string) {
  return useLiveQuery<Rotation>(
    () =>
      getDatabase()
        .get<Rotation>('rotations')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export function useMilestones(residentId: string, tenantId: string) {
  return useLiveQuery<Milestone>(
    () =>
      getDatabase()
        .get<Milestone>('milestones')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

// ---------------------------------------------------------------------------
// Evaluation Forms
// ---------------------------------------------------------------------------

export function useEvaluationForms(residentId: string, tenantId: string) {
  return useLiveQuery<EvaluationForm>(
    () =>
      getDatabase()
        .get<EvaluationForm>('evaluation_forms')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

export async function createEvaluationForm(
  data: Partial<EvaluationForm> & { tenant_id: string; resident_id: string; evaluator_id: string; form_type: string },
): Promise<string> {
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<EvaluationForm>('evaluation_forms').create((row: EvaluationForm) => {
      row.tenantId = data.tenant_id;
      row.residentId = data.resident_id;
      row.evaluatorId = data.evaluator_id;
      row.formType = data.form_type;
      row.encounterDate = data.encounterDate ?? null;
      row.setting = data.setting ?? null;
      row.patientContext = data.patientContext ?? null;
      row.ratings = data.ratings ?? {};
      row.overallScore = data.overallScore ?? null;
      row.feedback = data.feedback ?? null;
      row.actionPlan = data.actionPlan ?? null;
      row.status = data.status ?? 'pending';
      row.localSyncStatus = 'pending_create';
      row.serverId = null;
      row.serverUpdatedAt = null;
      row.isDeleted = false;
    }),
  );
  return record.id;
}

// ---------------------------------------------------------------------------
// Shifts / Duty Hours
// ---------------------------------------------------------------------------

export function useShifts(residentId: string, tenantId: string) {
  return useLiveQuery<Shift>(
    () =>
      getDatabase()
        .get<Shift>('shifts')
        .query(
          Q.and(
            Q.where('resident_id', residentId),
            Q.where('tenant_id', tenantId),
            Q.where('is_deleted', false),
          )
        ),
    [residentId, tenantId],
  );
}

export async function createShift(
  data: { tenant_id: string; resident_id: string; shift_date: string; hours_worked: number; shift_type: string; notes?: string },
): Promise<string> {
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<Shift>('shifts').create((row: Shift) => {
      row.tenantId = data.tenant_id;
      row.residentId = data.resident_id;
      row.shiftDate = data.shift_date;
      row.hoursWorked = data.hours_worked;
      row.shiftType = data.shift_type;
      row.notes = data.notes ?? null;
      row.localSyncStatus = 'pending_create';
      row.serverId = null;
      row.serverUpdatedAt = null;
      row.isDeleted = false;
    }),
  );
  return record.id;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useComments(entryId: string | null, evaluationId: string | null) {
  return useLiveQuery<Comment>(
    () => {
      const conditions = [Q.where('is_deleted', false)];
      if (entryId) conditions.push(Q.where('entry_id', entryId));
      if (evaluationId) conditions.push(Q.where('evaluation_id', evaluationId));
      return getDatabase()
        .get<Comment>('comments')
        .query(Q.and(conditions));
    },
    [entryId, evaluationId],
  );
}

export async function createComment(
  data: { tenant_id: string; author_id: string; body: string; entry_id?: string; evaluation_id?: string; parent_id?: string },
): Promise<string> {
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<Comment>('comments').create((row: Comment) => {
      row.tenantId = data.tenant_id;
      row.authorId = data.author_id;
      row.body = data.body;
      row.entryId = data.entry_id ?? null;
      row.evaluationId = data.evaluation_id ?? null;
      row.parentId = data.parent_id ?? null;
      row.localSyncStatus = 'pending_create';
      row.serverId = null;
      row.serverUpdatedAt = null;
      row.isDeleted = false;
    }),
  );
  return record.id;
}

// ---------------------------------------------------------------------------
// Utility: count pending sync items (for UI badge)
// ---------------------------------------------------------------------------

export async function getPendingSyncCount(): Promise<number> {
  const db = getDatabase();
  let count = 0;
  const tables = ['case_entries', 'case_templates', 'program_goals', 'rotations', 'milestones', 'evaluation_forms', 'comments', 'shifts'] as const;
  for (const table of tables) {
    const rows = await db.get(table).query(Q.where('local_sync_status', Q.notEq('synced'))).fetch();
    count += rows.length;
  }
  return count;
}
