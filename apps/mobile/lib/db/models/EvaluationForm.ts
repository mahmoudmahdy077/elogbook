import { Model } from '@nozbe/watermelondb';
import { field, text, date, json } from '@nozbe/watermelondb/decorators';

export class EvaluationForm extends Model {
  static table = 'evaluation_forms';

  @text('tenant_id') tenantId!: string;
  @text('resident_id') residentId!: string;
  @text('evaluator_id') evaluatorId!: string;
  @text('form_type') formType!: string;
  @text('encounter_date') encounterDate!: string | null;
  @text('setting') setting!: string | null;
  @text('patient_context') patientContext!: string | null;
  @json('ratings', (raw: string) => (raw ? JSON.parse(raw) : {})) ratings!: Record<string, unknown>;
  @field('overall_score') overallScore!: number | null;
  @text('feedback') feedback!: string | null;
  @text('action_plan') actionPlan!: string | null;
  @text('status') status!: string;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
