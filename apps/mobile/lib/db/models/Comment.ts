import { Model } from '@nozbe/watermelondb';
import { field, text, date } from '@nozbe/watermelondb/decorators';

export class Comment extends Model {
  static table = 'comments';

  @text('tenant_id') tenantId!: string;
  @text('entry_id') entryId!: string | null;
  @text('evaluation_id') evaluationId!: string | null;
  @text('author_id') authorId!: string;
  @text('body') body!: string;
  @text('parent_id') parentId!: string | null;
  @text('local_sync_status') localSyncStatus!: string;
  @text('server_id') serverId!: string | null;
  @field('server_updated_at') serverUpdatedAt!: number | null;
  @field('is_deleted') isDeleted!: boolean;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
