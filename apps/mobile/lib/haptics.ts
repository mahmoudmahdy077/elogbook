import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';

let cachedReduceMotion: boolean | null = null;
const subscribers = new Set<(v: boolean) => void>();

function applyValue(v: boolean) {
  cachedReduceMotion = v;
  subscribers.forEach((fn) => fn(v));
}

AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
  applyValue(enabled);
});

AccessibilityInfo.isReduceMotionEnabled?.().then?.((v: boolean) => {
  applyValue(v);
});

export function isReduceMotionEnabled(): boolean {
  return cachedReduceMotion === true;
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(cachedReduceMotion === true);
  useEffect(() => {
    const fn = (v: boolean) => setReduce(v);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return reduce;
}

export type HapticsController = {
  submitSuccess: () => Promise<unknown>;
  submitError: () => Promise<unknown>;
  offlineSave: () => Promise<unknown>;
  approvalAction: () => Promise<unknown>;
  selection: () => Promise<unknown>;
};

export function createHapticsController(shouldHaptic: () => boolean): HapticsController {
  const wrap = (fn: () => Promise<unknown>) => () => {
    if (!shouldHaptic()) return Promise.resolve();
    return fn().catch(() => undefined);
  };
  return {
    submitSuccess: wrap(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
    submitError: wrap(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
    offlineSave: wrap(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
    approvalAction: wrap(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
    selection: wrap(() => Haptics.selectionAsync()),
  };
}

export function useHaptics(): HapticsController {
  const reduce = useReduceMotion();
  return createHapticsController(() => !reduce);
}
