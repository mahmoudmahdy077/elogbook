import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './database';
import { CaseEntry } from './models/CaseEntry';
import { CaseTemplate } from './models/CaseTemplate';
import { ProgramGoal } from './models/ProgramGoal';
import type { CaseStatus } from '@elogbook/shared';

type RawRecord = Record<string, unknown>;

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
      const raw = entry._raw as RawRecord;
      entry.tenantId = data.tenantId;
      entry.residentId = data.residentId;
      entry.templateId = data.templateId;
      entry.patientMrn = data.patientMrn ?? null;
      entry.patientDob = data.patientDob ?? null;
      entry.patientAgeYears = data.patientAgeYears ?? null;
      entry.patientHash = data.patientHash ?? null;
      entry.caseDate = data.caseDate;
      raw.field_values = JSON.stringify(data.fieldValues ?? {});
      raw.accreditation_mappings = JSON.stringify(data.accreditationMappings ?? []);
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
  const all = await db.get<CaseEntry>('case_entries').query().fetch();
  return all.filter(
    (e) => e.localSyncStatus === 'draft' || e.localSyncStatus === 'conflict' || e.localSyncStatus === 'modified',
  );
}

export async function getConflictedCases(): Promise<CaseEntry[]> {
  const db = getDatabase();
  const all = await db.get<CaseEntry>('case_entries').query().fetch();
  return all.filter((e) => e.localSyncStatus === 'conflict');
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

export async function updateSyncStatus(entry: CaseEntry, status: string): Promise<void> {
  const db = getDatabase();
  await db.write(async () => {
    await entry.update((e) => {
      e.localSyncStatus = status;
    });
  });
}

export async function getAllCasesForResident(residentId: string): Promise<CaseEntry[]> {
  const db = getDatabase();
  const entries = await db.get<CaseEntry>('case_entries').query().fetch();
  return entries.filter(
    (e) => e.residentId === residentId && (e as unknown as { _raw: { _status: string } })._raw._status !== 'deleted',
  );
}

export async function getAllGoalsForResident(residentId: string): Promise<ProgramGoal[]> {
  const db = getDatabase();
  const goals = await db.get<ProgramGoal>('program_goals').query().fetch();
  return goals.filter(
    (g) => g.residentId === residentId && (g as unknown as { _raw: { _status: string } })._raw._status !== 'deleted',
  );
}

export async function upsertCaseEntry(serverData: Record<string, unknown>): Promise<CaseEntry> {
  const db = getDatabase();
  const existing = await db.get<CaseEntry>('case_entries').query().fetch();
  const match = existing.find((e) => e.id === String(serverData.id));

  return db.write(async () => {
    if (match) {
      return match.update((entry) => {
        const raw = entry._raw as RawRecord;
        entry.tenantId = String(serverData.tenant_id ?? entry.tenantId);
        entry.residentId = String(serverData.resident_id ?? entry.residentId);
        entry.templateId = String(serverData.template_id ?? entry.templateId);
        entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : entry.patientMrn;
        entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : entry.patientDob;
        entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : entry.patientAgeYears;
        entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : entry.patientHash;
        entry.caseDate = String(serverData.case_date ?? entry.caseDate);
        raw.field_values = typeof serverData.field_values === 'string' ? serverData.field_values : JSON.stringify(serverData.field_values ?? {});
        raw.accreditation_mappings = typeof serverData.accreditation_mappings === 'string' ? serverData.accreditation_mappings : JSON.stringify(serverData.accreditation_mappings ?? []);
        entry.isDeidentified = Boolean(serverData.is_deidentified ?? entry.isDeidentified);
        entry.status = String(serverData.status ?? entry.status);
        entry.localSyncStatus = 'synced';
        entry.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
    } else {
      return db.get<CaseEntry>('case_entries').create((entry) => {
        const raw = entry._raw as RawRecord;
        raw.id = String(serverData.id);
        entry.tenantId = String(serverData.tenant_id ?? '');
        entry.residentId = String(serverData.resident_id ?? '');
        entry.templateId = String(serverData.template_id ?? '');
        entry.patientMrn = serverData.patient_mrn != null ? String(serverData.patient_mrn) : null;
        entry.patientDob = serverData.patient_dob != null ? String(serverData.patient_dob) : null;
        entry.patientAgeYears = serverData.patient_age_years != null ? Number(serverData.patient_age_years) : null;
        entry.patientHash = serverData.patient_hash != null ? String(serverData.patient_hash) : null;
        entry.caseDate = String(serverData.case_date ?? '');
        raw.field_values = typeof serverData.field_values === 'string' ? String(serverData.field_values) : JSON.stringify(serverData.field_values ?? {});
        raw.accreditation_mappings = typeof serverData.accreditation_mappings === 'string' ? String(serverData.accreditation_mappings) : JSON.stringify(serverData.accreditation_mappings ?? []);
        entry.isDeidentified = Boolean(serverData.is_deidentified ?? true);
        entry.status = String(serverData.status ?? 'draft');
        entry.localSyncStatus = 'synced';
        entry.createdAt = serverData.created_at ? new Date(Number(serverData.created_at)) : new Date();
        entry.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
    }
  });
}

export async function upsertTemplate(serverData: Record<string, unknown>): Promise<CaseTemplate> {
  const db = getDatabase();
  const existing = await db.get<CaseTemplate>('case_templates').query().fetch();
  const match = existing.find((e) => e.id === String(serverData.id));

  return db.write(async () => {
    if (match) {
      return match.update((t) => {
        const raw = t._raw as RawRecord;
        t.tenantId = String(serverData.tenant_id ?? t.tenantId);
        t.specialty = String(serverData.specialty ?? t.specialty);
        t.name = String(serverData.name ?? t.name);
        raw.fields = typeof serverData.fields === 'string' ? serverData.fields : JSON.stringify(serverData.fields ?? []);
        raw.required_fields = typeof serverData.required_fields === 'string' ? serverData.required_fields : JSON.stringify(serverData.required_fields ?? []);
        t.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
    } else {
      return db.get<CaseTemplate>('case_templates').create((t) => {
        const raw = t._raw as RawRecord;
        raw.id = String(serverData.id);
        t.tenantId = String(serverData.tenant_id ?? '');
        t.specialty = String(serverData.specialty ?? '');
        t.name = String(serverData.name ?? '');
        raw.fields = typeof serverData.fields === 'string' ? serverData.fields : JSON.stringify(serverData.fields ?? []);
        raw.required_fields = typeof serverData.required_fields === 'string' ? serverData.required_fields : JSON.stringify(serverData.required_fields ?? []);
        t.createdAt = serverData.created_at ? new Date(Number(serverData.created_at)) : new Date();
        t.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
    }
  });
}

export async function upsertProgramGoal(serverData: Record<string, unknown>): Promise<ProgramGoal> {
  const db = getDatabase();
  const existing = await db.get<ProgramGoal>('program_goals').query().fetch();
  const match = existing.find((e) => e.id === String(serverData.id));

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
        g.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
    } else {
      return db.get<ProgramGoal>('program_goals').create((g) => {
        const raw = g._raw as RawRecord;
        raw.id = String(serverData.id);
        g.tenantId = String(serverData.tenant_id ?? '');
        g.residentId = String(serverData.resident_id ?? '');
        g.title = String(serverData.title ?? '');
        g.targetCount = Number(serverData.target_count ?? 0);
        g.currentCount = Number(serverData.current_count ?? 0);
        g.specialty = serverData.specialty != null ? String(serverData.specialty) : null;
        g.localSyncStatus = 'synced';
        g.createdAt = serverData.created_at ? new Date(Number(serverData.created_at)) : new Date();
        g.updatedAt = serverData.updated_at ? new Date(Number(serverData.updated_at)) : new Date();
      });
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