import { Model } from '@nozbe/watermelondb';
import { field, text, date } from '@nozbe/watermelondb/decorators';

export class ProgramGoal extends Model {
  static table = 'program_goals';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('title') title!: string;
  @field('target_count') targetCount!: number;
  @field('current_count') currentCount!: number;
  @text('specialty') specialty!: string | null;
  @text('local_sync_status') localSyncStatus!: string;
  @text('server_id') serverId!: string | null;
  @field('server_updated_at') serverUpdatedAt!: number | null;
  @field('is_deleted') isDeleted!: boolean;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
