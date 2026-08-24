import { Model } from '@nozbe/watermelondb';
import { field, text, date } from '@nozbe/watermelondb/decorators';

export class Milestone extends Model {
  static table = 'milestones';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('competency_area') competencyArea!: string;
  @text('sub_competency') subCompetency!: string;
  @field('level') level!: number;
  @text('assessor_id') assessorId!: string | null;
  @text('assessment_date') assessmentDate!: string;
  @text('evidence_entry_id') evidenceEntryId!: string | null;
  @text('comments') comments!: string | null;
  @text('local_sync_status') localSyncStatus!: string;
  @text('server_id') serverId!: string | null;
  @field('server_updated_at') serverUpdatedAt!: number | null;
  @field('is_deleted') isDeleted!: boolean;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
