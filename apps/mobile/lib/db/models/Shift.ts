import { Model } from '@nozbe/watermelondb';
import { field, text, date } from '@nozbe/watermelondb/decorators';

export class Shift extends Model {
  static table = 'shifts';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('shift_date') shiftDate!: string;
  @field('hours_worked') hoursWorked!: number;
  @text('shift_type') shiftType!: string;
  @text('notes') notes!: string | null;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
