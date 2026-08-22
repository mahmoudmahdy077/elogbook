import { Model } from '@nozbe/watermelondb';
import { field, text, date, json } from '@nozbe/watermelondb/decorators';
import type { TemplateField } from '@elogbook/shared';

export class CaseTemplate extends Model {
  static table = 'case_templates';

  @text('tenant_id') tenantId!: string;
  @text('specialty') specialty!: string;
  @text('name') name!: string;
  @json('fields', (raw: string) => (raw ? JSON.parse(raw) : [])) fields!: TemplateField[];
  @json('required_fields', (raw: string) => (raw ? JSON.parse(raw) : [])) requiredFields!: string[];
  @text('local_sync_status') localSyncStatus!: string;
  @text('server_id') serverId!: string | null;
  @field('server_updated_at') serverUpdatedAt!: number | null;
  @field('is_deleted') isDeleted!: boolean;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
