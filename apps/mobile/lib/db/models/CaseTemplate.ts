import { Model } from '@nozbe/watermelondb';
import { text, json, date } from '@nozbe/watermelondb/decorators';
import type { TemplateField } from '@elogbook/shared';

export class CaseTemplate extends Model {
  static table = 'case_templates';

  @text('tenant_id') tenantId!: string;
  @text('specialty') specialty!: string;
  @text('name') name!: string;
  @json('fields', (raw: string) => (raw ? JSON.parse(raw) : [])) fields!: TemplateField[];
  @json('required_fields', (raw: string) => (raw ? JSON.parse(raw) : [])) requiredFields!: string[];
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
