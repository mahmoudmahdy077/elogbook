export function notificationPayloadToBadgeIncrement(
  type: string | undefined,
): number {
  return type === 'case.approved' || type === 'case.rejected' || type === 'approval.pending' ? 1 : 0;
}
