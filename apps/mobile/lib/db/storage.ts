import { Q, Model } from '@nozbe/watermelondb';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './database';
import { CaseEntry } from './models/CaseEntry';
import { CaseTemplate } from './models/CaseTemplate';
import { ProgramGoal } from './models/ProgramGoal';
import { Rotation } from './models/Rotation';
import { Milestone } from './models/Milestone';
import { EvaluationForm } from './models/EvaluationForm';
import { Comment } from './models/Comment';
import type { CaseStatus } from '@elogbook/shared';

// Safely parse dates — Supabase returns ISO string timestamps,
// but old code used Number() which produces Invalid Date for strings.
function parseDate(value: unknown): Date {
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const num = Number(value);
    if (!isNaN(num)) return new Date(num);
    return new Date(value);
  }
  return new Date();
}

function readJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

type DraftCaseData = {
  tenantId: string;
  residentId: string;
  templateId: string;
  patientMrn?: string | null;
  patientDob?: string | null;
  patientAgeYears?: number | null;
  patientHash?: string | null;
  caseDate: string;
  fieldValues: Record<string, unknown>;
  accreditationMappings?: unknown[];
  isDeidentified: boolean;
  status?: CaseStatus;
};

export async function saveDraftCase(data: DraftCaseData): Promise<CaseEntry> {
  const db = getDatabase();
  const draft = await db.write(async () => {
    return db.get<CaseEntry>('case_entries').create((entry) => {
      entry.tenantId = data.tenantId;
      entry.residentId = data.residentId;
      entry.templateId = data.templateId;
      entry.patientMrn = data.patientMrn ?? null;
      entry.patientDob = data.patientDob ?? null;
      entry.patientAgeYears = data.patientAgeYears ?? null;
      entry.patientHash = data.patientHash ?? null;
      entry.caseDate = data.caseDate;
      entry.fieldValues = data.fieldValues ?? {};
      entry.accreditationMappings = data.accreditationMappings ?? [];
      entry.isDeidentified = data.isDeidentified;
      entry.status = data.status ?? 'draft';
      entry.localSyncStatus = 'draft';
      entry.createdAt = new Date();
      entry.updatedAt = new Date();
    });
  });
  return draft;
}

export async function getDraftCases(): Promise<CaseEntry[]> {
  const db = getDatabase();
  return db.get<CaseEntry>('case_entries')
    .query(Q.where('local_sync_status', Q.oneOf(['draft', 'conflict', 'modified'])))
    .fetch();
}

export async function getConflictedCases(): Promise<CaseEntry[]> {
  const db = getDatabase();
  return db.get<CaseEntry>('case_entries')
    .query(Q.where('local_sync_status', 'conflict'))
    .fetch();
}

export async function removeAllDrafts(): Promise<void> {
  const db = getDatabase();
  const drafts = await getDraftCases();
  await db.write(async () => {
    for (const draft of drafts) {
      await draft.markAsDeleted();
    }
  });
}

export async function removeDraft(entry: CaseEntry): Promise<void> {
  const db = getDatabase();
  await db.write(async () => {
    await entry.markAsDeleted();
  });
}

export async function updateSyncStatus(
  entry: CaseEntry,
  status: string,
  serverId?: string,
): Promise<void> {
  const db = getDatabase();
  await db.write(async () => {
    await entry.update((e) => {
      e.localSyncStatus = status;
      if (serverId) {
        e.serverId = serverId;
      }
    });
  });
}

export async function markCaseAsModified(entry: CaseEntry): Promise<void> {
  const db = getDatabase();
  await db.write(async () => {
    await entry.update((e) => {
      e.localSyncStatus = 'modified';
      e.updatedAt = new Date();
    });
  });
}

export async function markCaseAsConflict(entry: CaseEntry): Promise<void> {
  const db = getDatabase();
  await db.write(async () => {
    await entry.update((e) => {
      e.localSyncStatus = 'conflict';
    });
  });
}

export async function getAllCasesForResident(residentId: string): Promise<CaseEntry[]> {
  const db = getDatabase();
  return db.get<CaseEntry>('case_entries')
    .query(
      Q.and(
        Q.where('resident_id', residentId),
        Q.where('_status', Q.notEq('deleted')),
      )
    )
    .fetch();
}

export async function getAllGoalsForResident(residentId: string): Promise<ProgramGoal[]> {
  const db = getDatabase();
  return db.get<ProgramGoal>('program_goals')
    .query(
      Q.and(
        Q.where('resident_id', residentId),
        Q.where('_status', Q.notEq('deleted')),
      )
    )
    .fetch();
}

export async function upsertCaseEntry(serverData: Record<string, unknown>): Promise<CaseEntry> {
  const db = getDatabase();
  const existing = await db.get<CaseEntry>('case_entries')
    .query(Q.where('id', String(serverData.id)))
    .fetch();
  const match = existing.length > 0 ? existing[0] : null;

  // CRITICAL: Do NOT overwrite local unsynced changes with server data
  if (match) {
    const localStatus = match.localSyncStatus;
    if (localStatus === 'draft' || localStatus === 'modified' || localStatus === 'created') {
      return match;
    }
  }

  return db.write(async () => {
    if (match) {
      return match.update((entry) => {
        entry.tenantId = String(serverData.tenant_id ?? entry.tenantId);
        entry.residentId = String(serverData.resident_id ?? entry.residentId);
        entry.templateId = String(serverData.template_id ?? entry.templateId);
        entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : entry.patientMrn;
        entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : entry.patientDob;
        entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : entry.patientAgeYears;
        entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : entry.patientHash;
        entry.caseDate = String(serverData.case_date ?? entry.caseDate);
        entry.fieldValues = readJsonField(serverData.field_values, entry.fieldValues);
        entry.accreditationMappings = readJsonField(serverData.accreditation_mappings, entry.accreditationMappings);
        entry.isDeidentified = Boolean(serverData.is_deidentified ?? entry.isDeidentified);
        entry.status = String(serverData.status ?? entry.status);
        entry.localSyncStatus = 'synced';
        entry.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    } else {
      return db.get<CaseEntry>('case_entries').create((entry) => {
        (entry as unknown as { id: string }).id = String(serverData.id);
        entry.tenantId = String(serverData.tenant_id ?? '');
        entry.residentId = String(serverData.resident_id ?? '');
        entry.templateId = String(serverData.template_id ?? '');
        entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : null;
        entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : null;
        entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : null;
        entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : null;
        entry.caseDate = String(serverData.case_date ?? '');
        entry.fieldValues = readJsonField(serverData.field_values, {});
        entry.accreditationMappings = readJsonField(serverData.accreditation_mappings, []);
        entry.isDeidentified = Boolean(serverData.is_deidentified ?? true);
        entry.status = String(serverData.status ?? 'draft');
        entry.localSyncStatus = 'synced';
        entry.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        entry.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    }
  });
}

export async function upsertTemplate(serverData: Record<string, unknown>): Promise<CaseTemplate> {
  const db = getDatabase();
  const existing = await db.get<CaseTemplate>('case_templates')
    .query(Q.where('id', String(serverData.id)))
    .fetch();
  const match = existing.length > 0 ? existing[0] : null;

  return db.write(async () => {
    if (match) {
      return match.update((t) => {
        t.tenantId = String(serverData.tenant_id ?? t.tenantId);
        t.specialty = String(serverData.specialty ?? t.specialty);
        t.name = String(serverData.name ?? t.name);
        t.fields = readJsonField(serverData.fields, t.fields);
        t.requiredFields = readJsonField(serverData.required_fields, t.requiredFields);
        t.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    } else {
      return db.get<CaseTemplate>('case_templates').create((t) => {
        (t as unknown as { id: string }).id = String(serverData.id);
        t.tenantId = String(serverData.tenant_id ?? '');
        t.specialty = String(serverData.specialty ?? '');
        t.name = String(serverData.name ?? '');
        t.fields = readJsonField(serverData.fields, []);
        t.requiredFields = readJsonField(serverData.required_fields, []);
        t.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        t.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    }
  });
}

export async function upsertProgramGoal(serverData: Record<string, unknown>): Promise<ProgramGoal> {
  const db = getDatabase();
  const existing = await db.get<ProgramGoal>('program_goals')
    .query(Q.where('id', String(serverData.id)))
    .fetch();
  const match = existing.length > 0 ? existing[0] : null;

  return db.write(async () => {
    if (match) {
      return match.update((g) => {
        g.tenantId = String(serverData.tenant_id ?? g.tenantId);
        g.residentId = String(serverData.resident_id ?? g.residentId);
        g.title = String(serverData.title ?? g.title);
        g.targetCount = Number(serverData.target_count ?? g.targetCount);
        g.currentCount = Number(serverData.current_count ?? g.currentCount);
        g.specialty = serverData.specialty != null ? String(serverData.specialty) : g.specialty;
        g.localSyncStatus = 'synced';
        g.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    } else {
      return db.get<ProgramGoal>('program_goals').create((g) => {
        (g as unknown as { id: string }).id = String(serverData.id);
        g.tenantId = String(serverData.tenant_id ?? '');
        g.residentId = String(serverData.resident_id ?? '');
        g.title = String(serverData.title ?? '');
        g.targetCount = Number(serverData.target_count ?? 0);
        g.currentCount = Number(serverData.current_count ?? 0);
        g.specialty = serverData.specialty != null ? String(serverData.specialty) : null;
        g.localSyncStatus = 'synced';
        g.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        g.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    }
  });
}

export async function batchUpsertCaseEntries(serverDataList: Record<string, unknown>[]): Promise<void> {
  const db = getDatabase();
  const ids = serverDataList.map((s) => String(s.id)).filter(Boolean);
  const existingRecords = ids.length > 0
    ? await db.get<CaseEntry>('case_entries').query(Q.where('id', Q.oneOf(ids))).fetch()
    : [];
  const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

  await db.write(async () => {
    const batch = serverDataList.map((serverData) => {
      const id = String(serverData.id);
      const match = existingMap.get(id);

      if (match) {
        const localStatus = match.localSyncStatus;
        if (localStatus === 'draft' || localStatus === 'modified' || localStatus === 'created') {
          return null;
        }
        return match.prepareUpdate((entry) => {
          entry.tenantId = String(serverData.tenant_id ?? entry.tenantId);
          entry.residentId = String(serverData.resident_id ?? entry.residentId);
          entry.templateId = String(serverData.template_id ?? entry.templateId);
          entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : entry.patientMrn;
          entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : entry.patientDob;
          entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : entry.patientAgeYears;
          entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : entry.patientHash;
          entry.caseDate = String(serverData.case_date ?? entry.caseDate);
          entry.fieldValues = readJsonField(serverData.field_values, entry.fieldValues);
          entry.accreditationMappings = readJsonField(serverData.accreditation_mappings, entry.accreditationMappings);
          entry.isDeidentified = Boolean(serverData.is_deidentified ?? entry.isDeidentified);
          entry.status = String(serverData.status ?? entry.status);
          entry.localSyncStatus = 'synced';
          entry.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
        });
      }

      return db.get<CaseEntry>('case_entries').prepareCreate((entry) => {
        (entry as unknown as { id: string }).id = String(serverData.id);
        entry.tenantId = String(serverData.tenant_id ?? '');
        entry.residentId = String(serverData.resident_id ?? '');
        entry.templateId = String(serverData.template_id ?? '');
        entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : null;
        entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : null;
        entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : null;
        entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : null;
        entry.caseDate = String(serverData.case_date ?? '');
        entry.fieldValues = readJsonField(serverData.field_values, {});
        entry.accreditationMappings = readJsonField(serverData.accreditation_mappings, []);
        entry.isDeidentified = Boolean(serverData.is_deidentified ?? true);
        entry.status = String(serverData.status ?? 'draft');
        entry.localSyncStatus = 'synced';
        entry.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        entry.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    });

    const validBatch = batch.filter((r): r is CaseEntry => r !== null);
    if (validBatch.length > 0) {
      await db.batch(...validBatch);
    }
  });
}

export async function batchUpsertTemplates(serverDataList: Record<string, unknown>[]): Promise<void> {
  const db = getDatabase();
  const ids = serverDataList.map((s) => String(s.id)).filter(Boolean);
  const existingRecords = ids.length > 0
    ? await db.get<CaseTemplate>('case_templates').query(Q.where('id', Q.oneOf(ids))).fetch()
    : [];
  const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

  await db.write(async () => {
    const batch = serverDataList.map((serverData) => {
      const id = String(serverData.id);
      const match = existingMap.get(id);

      if (match) {
        return match.prepareUpdate((t) => {
          t.tenantId = String(serverData.tenant_id ?? t.tenantId);
          t.specialty = String(serverData.specialty ?? t.specialty);
          t.name = String(serverData.name ?? t.name);
          t.fields = readJsonField(serverData.fields, t.fields);
          t.requiredFields = readJsonField(serverData.required_fields, t.requiredFields);
          t.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
        });
      }

      return db.get<CaseTemplate>('case_templates').prepareCreate((t) => {
        (t as unknown as { id: string }).id = String(serverData.id);
        t.tenantId = String(serverData.tenant_id ?? '');
        t.specialty = String(serverData.specialty ?? '');
        t.name = String(serverData.name ?? '');
        t.fields = readJsonField(serverData.fields, []);
        t.requiredFields = readJsonField(serverData.required_fields, []);
        t.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        t.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    });

    if (batch.length > 0) {
      await db.batch(...batch);
    }
  });
}

export async function batchUpsertGoals(serverDataList: Record<string, unknown>[]): Promise<void> {
  const db = getDatabase();
  const ids = serverDataList.map((s) => String(s.id)).filter(Boolean);
  const existingRecords = ids.length > 0
    ? await db.get<ProgramGoal>('program_goals').query(Q.where('id', Q.oneOf(ids))).fetch()
    : [];
  const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

  await db.write(async () => {
    const batch = serverDataList.map((serverData) => {
      const id = String(serverData.id);
      const match = existingMap.get(id);

      if (match) {
        return match.prepareUpdate((g) => {
          g.tenantId = String(serverData.tenant_id ?? g.tenantId);
          g.residentId = String(serverData.resident_id ?? g.residentId);
          g.title = String(serverData.title ?? g.title);
          g.targetCount = Number(serverData.target_count ?? g.targetCount);
          g.currentCount = Number(serverData.current_count ?? g.currentCount);
          g.specialty = serverData.specialty != null ? String(serverData.specialty) : g.specialty;
          g.localSyncStatus = 'synced';
          g.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
        });
      }

      return db.get<ProgramGoal>('program_goals').prepareCreate((g) => {
        (g as unknown as { id: string }).id = String(serverData.id);
        g.tenantId = String(serverData.tenant_id ?? '');
        g.residentId = String(serverData.resident_id ?? '');
        g.title = String(serverData.title ?? '');
        g.targetCount = Number(serverData.target_count ?? 0);
        g.currentCount = Number(serverData.current_count ?? 0);
        g.specialty = serverData.specialty != null ? String(serverData.specialty) : null;
        g.localSyncStatus = 'synced';
        g.createdAt = serverData.created_at ? parseDate(serverData.created_at) : new Date();
        g.updatedAt = serverData.updated_at ? parseDate(serverData.updated_at) : new Date();
      });
    });

    if (batch.length > 0) {
      await db.batch(...batch);
    }
  });
}

export async function getLastSyncTimestamp(): Promise<number | null> {
  const val = await AsyncStorage.getItem('last_sync_timestamp');
  return val ? parseInt(val, 10) : null;
}

export async function setLastSyncTimestamp(ts: number): Promise<void> {
  await AsyncStorage.setItem('last_sync_timestamp', ts.toString());
}

export async function getPreference(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function setPreference(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

// ── Batch upsert helpers for sync pull ──────────────────────────────────

async function batchUpsertGeneric<T extends Model>(
  tableName: string,
  serverDataList: Record<string, unknown>[],
  applyCreate: (record: T, data: Record<string, unknown>) => void,
  applyUpdate: (record: T, data: Record<string, unknown>) => void,
): Promise<void> {
  const db = getDatabase();
  const ids = serverDataList.map((s) => String(s.id)).filter(Boolean);
  const existingRecords = ids.length > 0
    ? await db.get<T>(tableName).query(Q.where('id', Q.oneOf(ids))).fetch()
    : [];
  const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

  await db.write(async () => {
    const batch = serverDataList.map((serverData) => {
      const id = String(serverData.id);
      const match = existingMap.get(id) as T | undefined;

      if (match) {
        return match.prepareUpdate((record: Record<string, unknown>) => {
          applyUpdate(record as T, serverData);
        });
      }

      return db.get<T>(tableName).prepareCreate((record: Record<string, unknown>) => {
        record.id = String(serverData.id);
        applyCreate(record as T, serverData);
      });
    });

    if (batch.length > 0) {
      await db.batch(...batch);
    }
  });
}

export async function batchUpsertRotations(serverDataList: Record<string, unknown>[]): Promise<void> {
  return batchUpsertGeneric<Rotation>('rotations', serverDataList,
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? '');
      r.residentId = String(d.resident_id ?? '');
      r.title = String(d.title ?? '');
      r.specialty = d.specialty != null ? String(d.specialty) : null;
      r.startDate = String(d.start_date ?? '');
      r.endDate = String(d.end_date ?? '');
      r.site = d.site != null ? String(d.site) : null;
      r.supervisorId = d.supervisor_id != null ? String(d.supervisor_id) : null;
      r.status = String(d.status ?? 'active');
      r.notes = d.notes != null ? String(d.notes) : null;
      r.createdAt = d.created_at ? parseDate(d.created_at) : new Date();
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? r.tenantId);
      r.residentId = String(d.resident_id ?? r.residentId);
      r.title = String(d.title ?? r.title);
      r.specialty = d.specialty != null ? String(d.specialty) : r.specialty;
      r.startDate = String(d.start_date ?? r.startDate);
      r.endDate = String(d.end_date ?? r.endDate);
      r.site = d.site != null ? String(d.site) : r.site;
      r.supervisorId = d.supervisor_id != null ? String(d.supervisor_id) : r.supervisorId;
      r.status = String(d.status ?? r.status);
      r.notes = d.notes != null ? String(d.notes) : r.notes;
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
  );
}

export async function batchUpsertMilestones(serverDataList: Record<string, unknown>[]): Promise<void> {
  return batchUpsertGeneric<Milestone>('milestones', serverDataList,
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? '');
      r.residentId = String(d.resident_id ?? '');
      r.competencyArea = String(d.competency_area ?? '');
      r.subCompetency = String(d.sub_competency ?? '');
      r.level = Number(d.level ?? 0);
      r.assessorId = d.assessor_id != null ? String(d.assessor_id) : null;
      r.assessmentDate = String(d.assessment_date ?? '');
      r.evidenceEntryId = d.evidence_entry_id != null ? String(d.evidence_entry_id) : null;
      r.comments = d.comments != null ? String(d.comments) : null;
      r.createdAt = d.created_at ? parseDate(d.created_at) : new Date();
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? r.tenantId);
      r.residentId = String(d.resident_id ?? r.residentId);
      r.competencyArea = String(d.competency_area ?? r.competencyArea);
      r.subCompetency = String(d.sub_competency ?? r.subCompetency);
      r.level = Number(d.level ?? r.level);
      r.assessorId = d.assessor_id != null ? String(d.assessor_id) : r.assessorId;
      r.assessmentDate = String(d.assessment_date ?? r.assessmentDate);
      r.evidenceEntryId = d.evidence_entry_id != null ? String(d.evidence_entry_id) : r.evidenceEntryId;
      r.comments = d.comments != null ? String(d.comments) : r.comments;
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
  );
}

export async function batchUpsertEvaluationForms(serverDataList: Record<string, unknown>[]): Promise<void> {
  return batchUpsertGeneric<EvaluationForm>('evaluation_forms', serverDataList,
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? '');
      r.residentId = String(d.resident_id ?? '');
      r.evaluatorId = String(d.evaluator_id ?? '');
      r.formType = String(d.form_type ?? '');
      r.encounterDate = d.encounter_date != null ? String(d.encounter_date) : null;
      r.setting = d.setting != null ? String(d.setting) : null;
      r.patientContext = d.patient_context != null ? String(d.patient_context) : null;
      r.ratings = readJsonField(d.ratings, {});
      r.overallScore = d.overall_score != null ? Number(d.overall_score) : null;
      r.feedback = d.feedback != null ? String(d.feedback) : null;
      r.actionPlan = d.action_plan != null ? String(d.action_plan) : null;
      r.status = String(d.status ?? 'draft');
      r.createdAt = d.created_at ? parseDate(d.created_at) : new Date();
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? r.tenantId);
      r.residentId = String(d.resident_id ?? r.residentId);
      r.evaluatorId = String(d.evaluator_id ?? r.evaluatorId);
      r.formType = String(d.form_type ?? r.formType);
      r.encounterDate = d.encounter_date != null ? String(d.encounter_date) : r.encounterDate;
      r.setting = d.setting != null ? String(d.setting) : r.setting;
      r.patientContext = d.patient_context != null ? String(d.patient_context) : r.patientContext;
      r.ratings = readJsonField(d.ratings, r.ratings);
      r.overallScore = d.overall_score != null ? Number(d.overall_score) : r.overallScore;
      r.feedback = d.feedback != null ? String(d.feedback) : r.feedback;
      r.actionPlan = d.action_plan != null ? String(d.action_plan) : r.actionPlan;
      r.status = String(d.status ?? r.status);
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
  );
}

export async function batchUpsertComments(serverDataList: Record<string, unknown>[]): Promise<void> {
  return batchUpsertGeneric<Comment>('comments', serverDataList,
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? '');
      r.entryId = d.entry_id != null ? String(d.entry_id) : null;
      r.evaluationId = d.evaluation_id != null ? String(d.evaluation_id) : null;
      r.authorId = String(d.author_id ?? '');
      r.body = String(d.body ?? '');
      r.parentId = d.parent_id != null ? String(d.parent_id) : null;
      r.createdAt = d.created_at ? parseDate(d.created_at) : new Date();
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
    (r, d) => {
      r.tenantId = String(d.tenant_id ?? r.tenantId);
      r.entryId = d.entry_id != null ? String(d.entry_id) : r.entryId;
      r.evaluationId = d.evaluation_id != null ? String(d.evaluation_id) : r.evaluationId;
      r.authorId = String(d.author_id ?? r.authorId);
      r.body = String(d.body ?? r.body);
      r.parentId = d.parent_id != null ? String(d.parent_id) : r.parentId;
      r.updatedAt = d.updated_at ? parseDate(d.updated_at) : new Date();
    },
  );
}

export const MAX_LOCAL_CASES = 500;

export async function pruneOldestCaseEntries(): Promise<number> {
  const db = getDatabase();
  const all = await db.get<CaseEntry>('case_entries')
    .query(
      Q.and(
        Q.where('_status', Q.notEq('deleted')),
        Q.where('local_sync_status', 'synced'),
      ),
      Q.sortBy('updated_at', Q.asc),
    )
    .fetch();

  if (all.length <= MAX_LOCAL_CASES) return 0;

  const toDelete = all.slice(0, all.length - MAX_LOCAL_CASES);
  await db.write(async () => {
    for (const entry of toDelete) {
      await entry.markAsDeleted();
    }
  });
  return toDelete.length;
}
