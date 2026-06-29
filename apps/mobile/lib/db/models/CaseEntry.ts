import { Model } from '@nozbe/watermelondb';
import { field, date, text, json } from '@nozbe/watermelondb/decorators';

export class CaseEntry extends Model {
  static table = 'case_entries';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('template_id') templateId!: string;
  @text('patient_mrn') patientMrn!: string | null;
  @text('patient_dob') patientDob!: string | null;
  @field('patient_age_years') patientAgeYears!: number | null;
  @text('patient_hash') patientHash!: string | null;
  @text('case_date') caseDate!: string;
  @json('field_values', (raw: string) => (raw ? JSON.parse(raw) : {})) fieldValues!: Record<string, unknown>;
  @json('accreditation_mappings', (raw: string) => (raw ? JSON.parse(raw) : [])) accreditationMappings!: unknown[];
  @field('is_deidentified') isDeidentified!: boolean;
  @text('status') status!: string;
  @text('local_sync_status') localSyncStatus!: string;
  @text('server_id') serverId!: string | null;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
