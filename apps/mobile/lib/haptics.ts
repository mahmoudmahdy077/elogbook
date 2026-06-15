import * as Haptics from 'expo-haptics';

export function useHaptics() {
  return {
    submitSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    submitError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    offlineSave: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    approvalAction: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
    selection: () => Haptics.selectionAsync(),
  };
}
