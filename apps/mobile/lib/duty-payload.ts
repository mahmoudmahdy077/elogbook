import { toLocalDateISO } from '@elogbook/shared';
export function buildDutyPeriodPayload(
  profile: { id: string; tenant_id: string },
  date: Date,
  hours: string,
  shiftType: string,
  notes: string,
) {
  return {
    tenant_id: profile.tenant_id,
    resident_id: profile.id,
    shift_date: toLocalDateISO(date),
    hours_worked: Number(hours),
    shift_type: shiftType,
    notes: notes || null,
  };
}
