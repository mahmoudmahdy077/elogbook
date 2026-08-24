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
    shift_date: date.toISOString().slice(0, 10),
    hours_worked: Number(hours),
    shift_type: shiftType,
    notes: notes || null,
  };
}
