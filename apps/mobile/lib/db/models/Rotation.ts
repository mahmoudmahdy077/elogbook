import { Model } from '@nozbe/watermelondb';
import { text, date } from '@nozbe/watermelondb/decorators';

export class Rotation extends Model {
  static table = 'rotations';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('title') title!: string;
  @text('specialty') specialty!: string | null;
  @text('start_date') startDate!: string;
  @text('end_date') endDate!: string;
  @text('site') site!: string | null;
  @text('supervisor_id') supervisorId!: string | null;
  @text('status') status!: string;
  @text('notes') notes!: string | null;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
