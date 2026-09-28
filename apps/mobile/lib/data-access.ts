/**
 * Offline-first data-access layer.
 *
 * Every screen reads from the local WatermelonDB (fast, works offline)
 * and writes to the local DB with a pending sync status. The SyncEngine
 * pushes changes to Supabase when online. When the server responds with
 * newer data (e.g. supervisor approval), the pull phase merges it locally.
 *
 * SECURITY: all data is scoped to the current tenant + user. Production
 * callers cannot initialize the plaintext SQLite adapter; the development
 * adapter seals the explicitly covered PHI fields through the AEAD module.
 *
 * This module provides React hooks that screens import directly.
 */

import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import type { Model, Query } from '@nozbe/watermelondb';
import { getDatabase } from './db/database';
import { encryptText, decryptText } from './crypto/aead';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { getAccountContext } from './account-context';

// ── PHI field encryption (SEC-006) ───────────────────────────────────────────
// The development SQLite adapter is not SQLCipher-encrypted. The production
// guard prevents this path from opening; covered PHI fields use the AEAD module.
async function phiKey(): Promise<Uint8Array> {
  const hex = await getOrCreateDbEncryptionKey();
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sealPhi(value: string | null): Promise<string | null> {
  if (value === null || value === undefined || value === '') return value ?? null;
  return encryptText(await phiKey(), value);
}
export async function openPhi(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined || value === '') return value ?? null;
  try {
    return decryptText(await phiKey(), value);
  } catch {
    return null;
  }
}

export interface ClinicalScope {
  tenantId: string;
  profileId: string;
  userId: string;
  role?: string;
  sessionId?: string;
  status?: 'active' | 'suspended' | 'disabled';
  tenantStatus?: 'active' | 'suspended' | 'disabled';
  expiresAt?: number | null;
  scopeKey: string;
}

const TENANT_WIDE_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);

export function getActiveClinicalScope(): ClinicalScope {
  const context = getAccountContext();
  if (!context || !context.userId || !context.tenantId || !context.profileId) {
    throw new Error('[data-access] active account context required');
  }
  if ((context.status && context.status !== 'active') || (context.tenantStatus && context.tenantStatus !== 'active')) {
    throw new Error('[data-access] inactive account or tenant scope');
  }
  if (context.expiresAt !== undefined && context.expiresAt !== null && context.expiresAt <= Date.now()) {
    throw new Error('[data-access] expired session scope');
  }
  return {
    tenantId: context.tenantId,
    profileId: context.profileId,
    userId: context.userId,
    role: context.role,
    sessionId: context.sessionId,
    status: context.status,
    tenantStatus: context.tenantStatus,
    expiresAt: context.expiresAt,
    scopeKey: `${context.userId}:${context.tenantId}:${context.profileId}:${context.sessionId ?? 'no-session'}`,
  };
}

function isTenantWide(scope: ClinicalScope): boolean {
  return scope.role !== undefined && TENANT_WIDE_ROLES.has(scope.role);
}

function canAccessProfile(scope: ClinicalScope, profileId: string): boolean {
  return scope.profileId === profileId || isTenantWide(scope);
}

function resolveScope(tenantId?: string, profileId?: string): { scope: ClinicalScope; tenantId: string; profileId: string } {
  const scope = getActiveClinicalScope();
  const resolvedTenantId = tenantId ?? scope.tenantId;
  const resolvedProfileId = profileId ?? scope.profileId;
  if (resolvedTenantId !== scope.tenantId) throw new Error('[data-access] tenant scope mismatch');
  if (!canAccessProfile(scope, resolvedProfileId)) throw new Error('[data-access] profile scope mismatch');
  return { scope, tenantId: resolvedTenantId, profileId: resolvedProfileId };
}

function accountScopeVersion(): string {
  const context = getAccountContext();
  return context
    ? `${context.userId}:${context.tenantId}:${context.profileId}:${context.sessionId ?? ''}:${context.status ?? ''}:${context.tenantStatus ?? ''}:${context.expiresAt ?? ''}`
    : 'signed-out';
}

function clinicalConditions(tenantId: string, scopeKey: string, profileColumn?: string, profileId?: string) {
  const conditions = [Q.where('tenant_id', tenantId), Q.where('local_scope', scopeKey)];
  if (profileColumn && profileId) conditions.push(Q.where(profileColumn, profileId));
  conditions.push(Q.where('is_deleted', false));
  return Q.and(conditions);
}

async function findScoped<T extends Model>(
  table: string,
  id: string,
  tenantId: string,
  scopeKey: string,
  profileColumn: string,
  profileId: string,
): Promise<T> {
  const collection = getDatabase().get<T>(table);
  const records = await collection.query(
    Q.and(
      Q.where('id', id),
      Q.where('tenant_id', tenantId),
      Q.where('local_scope', scopeKey),
      Q.where(profileColumn, profileId),
      Q.where('is_deleted', false),
    ),
  ).fetch();
  const record = records[0];
  if (!record) throw new Error(`[data-access] scoped ${table} row not found`);
  return record;
}

async function sealJson(value: unknown): Promise<Record<string, unknown>> {
  const sealed = await sealPhi(JSON.stringify(value ?? {}));
  return sealed ? { __sealed: sealed } : {};
}

async function openJson(value: unknown): Promise<Record<string, unknown>> {
  const sealed = value && typeof value === 'object' && '__sealed' in value
    ? (value as { __sealed?: unknown }).__sealed
    : typeof value === 'string' ? value : null;
  if (typeof sealed !== 'string') return {};
  const plaintext = await openPhi(sealed);
  if (!plaintext) return {};
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
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
    let query: Query<T>;
    try {
      query = queryFn();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setLoading(false);
      return;
    }

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
  const version = accountScopeVersion();
  return useLiveQuery<CaseEntry>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<CaseEntry>('case_entries')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

export function useCaseEntry(id: string, residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<CaseEntry>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<CaseEntry>('case_entries')
        .query(
          Q.and(
            Q.where('id', id),
            Q.where('tenant_id', resolved.tenantId),
            Q.where('local_scope', resolved.scope.scopeKey),
            Q.where('resident_id', resolved.profileId),
            Q.where('is_deleted', false),
          ),
        );
    },
    [id, residentId, tenantId, version],
  );
}

export function useShift(id: string, residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<Shift>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<Shift>('shifts')
        .query(
          Q.and(
            Q.where('id', id),
            Q.where('tenant_id', resolved.tenantId),
            Q.where('local_scope', resolved.scope.scopeKey),
            Q.where('resident_id', resolved.profileId),
            Q.where('is_deleted', false),
          ),
        );
    },
    [id, residentId, tenantId, version],
  );
}

export async function createCaseEntry(
  data: Partial<CaseEntry> & { tenant_id: string; resident_id: string },
): Promise<string> {
  const resolved = resolveScope(data.tenant_id, data.resident_id);
  const db = getDatabase();
  const [mrn, dob, fv] = await Promise.all([
    sealPhi(data.patientMrn ?? null),
    sealPhi(data.patientDob ?? null),
    sealPhi(JSON.stringify(data.fieldValues ?? {})),
  ]);
  const record = await db.write(() =>
    db.get<CaseEntry>('case_entries').create((row: CaseEntry) => {
      row.tenantId = resolved.tenantId;
      row.localScope = resolved.scope.scopeKey;
      row.residentId = resolved.profileId;
      row.templateId = data.templateId ?? '';
      row.patientMrn = mrn;
      row.patientDob = dob;
      row.patientAgeYears = data.patientAgeYears ?? null;
      row.patientHash = data.patientHash ?? null;
      row.caseDate = data.caseDate ?? new Date().toISOString().slice(0, 10);
      row.fieldValues = fv ? ({ __sealed: fv } as Record<string, unknown>) : {};
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
  residentId?: string,
  tenantId?: string,
): Promise<void> {
  const resolved = resolveScope(tenantId, residentId);
  const [mrn, dob, fv] = await Promise.all([
    changes.patientMrn !== undefined ? sealPhi(changes.patientMrn) : Promise.resolve(undefined),
    changes.patientDob !== undefined ? sealPhi(changes.patientDob) : Promise.resolve(undefined),
    changes.fieldValues !== undefined
      ? sealPhi(JSON.stringify(changes.fieldValues))
      : Promise.resolve(undefined),
  ]);
  const db = getDatabase();
  const record = await findScoped<CaseEntry>('case_entries', id, resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId);
  await db.write(() =>
    record.update((row: CaseEntry) => {
      if (changes.status !== undefined) row.status = changes.status;
      if (fv !== undefined) row.fieldValues = fv ? ({ __sealed: fv } as Record<string, unknown>) : {};
      if (mrn !== undefined) row.patientMrn = mrn;
      if (dob !== undefined) row.patientDob = dob;
      row.localSyncStatus = 'pending_update';
    }),
  );
}

/** Decrypt the PHI fields of a stored case row (returns nulls on key mismatch). */
export async function openCaseEntryPhi(row: {
  patientMrn: string | null;
  patientDob: string | null;
  fieldValues: Record<string, unknown>;
}): Promise<{ patientMrn: string | null; patientDob: string | null; fieldValues: Record<string, unknown> }> {
  const [patientMrn, patientDob, fieldValues] = await Promise.all([
    openPhi(row.patientMrn),
    openPhi(row.patientDob),
    openJson(row.fieldValues),
  ]);
  return { patientMrn, patientDob, fieldValues };
}

export async function openEvaluationFormPhi(row: {
  setting: string | null;
  patientContext: string | null;
  ratings: Record<string, unknown>;
  feedback: string | null;
  actionPlan: string | null;
}): Promise<{
  setting: string | null;
  patientContext: string | null;
  ratings: Record<string, unknown>;
  feedback: string | null;
  actionPlan: string | null;
}> {
  const [setting, patientContext, ratings, feedback, actionPlan] = await Promise.all([
    openPhi(row.setting),
    openPhi(row.patientContext),
    openJson(row.ratings),
    openPhi(row.feedback),
    openPhi(row.actionPlan),
  ]);
  return { setting, patientContext, ratings, feedback, actionPlan };
}

export async function openCommentPhi(body: string | null): Promise<string | null> {
  return openPhi(body);
}

export async function deleteCaseEntry(id: string, residentId?: string, tenantId?: string): Promise<void> {
  const resolved = resolveScope(tenantId, residentId);
  const db = getDatabase();
  const record = await findScoped<CaseEntry>('case_entries', id, resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId);
  await db.write(() =>
    record.update((row: CaseEntry) => {
      row.isDeleted = true;
      row.localSyncStatus = 'pending_delete';
    }),
  );
}

// ---------------------------------------------------------------------------
// Case Templates (read-only on mobile, synced from server)
// ---------------------------------------------------------------------------

export function useCaseTemplates(tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<CaseTemplate>(
    () => {
      const scope = getActiveClinicalScope();
      if (scope.tenantId !== tenantId) throw new Error('[data-access] tenant scope mismatch');
      return getDatabase()
        .get<CaseTemplate>('case_templates')
        .query(clinicalConditions(tenantId, scope.scopeKey));
    },
    [tenantId, version],
  );
}

// ---------------------------------------------------------------------------
// Program Goals
// ---------------------------------------------------------------------------

export function useProgramGoals(residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<ProgramGoal>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<ProgramGoal>('program_goals')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

// ---------------------------------------------------------------------------
// Rotations
// ---------------------------------------------------------------------------

export function useRotations(residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<Rotation>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<Rotation>('rotations')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export function useMilestones(residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<Milestone>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<Milestone>('milestones')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

// ---------------------------------------------------------------------------
// Evaluation Forms
// ---------------------------------------------------------------------------

export function useEvaluationForms(residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<EvaluationForm>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<EvaluationForm>('evaluation_forms')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

export function useEvaluationForm(id: string, residentId: string, tenantId: string) {
  const version = accountScopeVersion();
  return useLiveQuery<EvaluationForm>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<EvaluationForm>('evaluation_forms')
        .query(
          Q.and(
            Q.where('id', id),
            Q.where('tenant_id', resolved.tenantId),
            Q.where('local_scope', resolved.scope.scopeKey),
            Q.where('resident_id', resolved.profileId),
            Q.where('is_deleted', false),
          ),
        );
    },
    [id, residentId, tenantId, version],
  );
}

export async function createEvaluationForm(
  data: Partial<EvaluationForm> & { tenant_id: string; resident_id: string; evaluator_id: string; form_type: string },
): Promise<string> {
  const resolved = resolveScope(data.tenant_id, data.resident_id);
  if (!canAccessProfile(resolved.scope, data.evaluator_id)) throw new Error('[data-access] evaluator scope mismatch');
  const [setting, patientContext, ratings, feedback, actionPlan] = await Promise.all([
    sealPhi(data.setting ?? null),
    sealPhi(data.patientContext ?? null),
    sealJson(data.ratings ?? {}),
    sealPhi(data.feedback ?? null),
    sealPhi(data.actionPlan ?? null),
  ]);
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<EvaluationForm>('evaluation_forms').create((row: EvaluationForm) => {
      row.tenantId = resolved.tenantId;
      row.localScope = resolved.scope.scopeKey;
      row.residentId = resolved.profileId;
      row.evaluatorId = data.evaluator_id;
      row.formType = data.form_type;
      row.encounterDate = data.encounterDate ?? null;
      row.setting = setting;
      row.patientContext = patientContext;
      row.ratings = ratings;
      row.overallScore = data.overallScore ?? null;
      row.feedback = feedback;
      row.actionPlan = actionPlan;
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
  const version = accountScopeVersion();
  return useLiveQuery<Shift>(
    () => {
      const resolved = resolveScope(tenantId, residentId);
      return getDatabase()
        .get<Shift>('shifts')
        .query(clinicalConditions(resolved.tenantId, resolved.scope.scopeKey, 'resident_id', resolved.profileId));
    },
    [residentId, tenantId, version],
  );
}

export async function createShift(
  data: { tenant_id: string; resident_id: string; shift_date: string; hours_worked: number; shift_type: string; notes?: string },
): Promise<string> {
  const resolved = resolveScope(data.tenant_id, data.resident_id);
  const notes = await sealPhi(data.notes ?? null);
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<Shift>('shifts').create((row: Shift) => {
      row.tenantId = resolved.tenantId;
      row.localScope = resolved.scope.scopeKey;
      row.residentId = resolved.profileId;
      row.shiftDate = data.shift_date;
      row.hoursWorked = data.hours_worked;
      row.shiftType = data.shift_type;
      row.notes = notes;
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

export function useComments(entryId: string | null, evaluationId: string | null, tenantId?: string) {
  const version = accountScopeVersion();
  return useLiveQuery<Comment>(
    () => {
      const scope = getActiveClinicalScope();
      if (tenantId !== undefined && tenantId !== scope.tenantId) throw new Error('[data-access] tenant scope mismatch');
      const conditions = [Q.where('tenant_id', scope.tenantId), Q.where('local_scope', scope.scopeKey), Q.where('is_deleted', false)];
      if (entryId) conditions.push(Q.where('entry_id', entryId));
      if (evaluationId) conditions.push(Q.where('evaluation_id', evaluationId));
      return getDatabase()
        .get<Comment>('comments')
        .query(Q.and(conditions));
    },
    [entryId, evaluationId, tenantId, version],
  );
}

export async function createComment(
  data: { tenant_id: string; author_id: string; body: string; entry_id?: string; evaluation_id?: string; parent_id?: string },
): Promise<string> {
  const resolved = resolveScope(data.tenant_id, data.author_id);
  const body = await sealPhi(data.body);
  const db = getDatabase();
  const record = await db.write(() =>
    db.get<Comment>('comments').create((row: Comment) => {
      row.tenantId = resolved.tenantId;
      row.localScope = resolved.scope.scopeKey;
      row.authorId = resolved.profileId;
      row.body = body ?? '';
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
  const scope = getActiveClinicalScope();
  const db = getDatabase();
  let count = 0;
  const tables = ['case_entries', 'case_templates', 'program_goals', 'rotations', 'milestones', 'evaluation_forms', 'comments', 'shifts'] as const;
  for (const table of tables) {
    const conditions = [Q.where('tenant_id', scope.tenantId), Q.where('local_scope', scope.scopeKey), Q.where('local_sync_status', Q.notEq('synced'))];
    if (['case_entries', 'program_goals', 'rotations', 'milestones', 'evaluation_forms', 'shifts'].includes(table) && !isTenantWide(scope)) {
      conditions.push(Q.where('resident_id', scope.profileId));
    }
    if (table === 'comments' && !isTenantWide(scope)) conditions.push(Q.where('author_id', scope.profileId));
    const rows = await db.get(table).query(Q.and(conditions)).fetch();
    count += rows.length;
  }
  return count;
}
