import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    notification: vi.fn().mockResolvedValue(undefined),
    impact: vi.fn().mockResolvedValue(undefined),
    selection: vi.fn().mockResolvedValue(undefined),
    isReduceMotionEnabled: vi.fn().mockResolvedValue(false),
    addEventListener: vi.fn(),
  };
});

vi.mock('expo-haptics', () => ({
  notificationAsync: mocks.notification,
  impactAsync: mocks.impact,
  selectionAsync: mocks.selection,
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
  ImpactFeedbackStyle: { Heavy: 'heavy' },
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => mocks.isReduceMotionEnabled(),
    addEventListener: (event: string, cb: unknown) => {
      mocks.addEventListener(event, cb);
      return { remove: () => undefined };
    },
  },
}));

import { createHapticsController, isReduceMotionEnabled } from '../haptics';

beforeEach(() => {
  mocks.notification.mockClear();
  mocks.impact.mockClear();
  mocks.selection.mockClear();
  mocks.isReduceMotionEnabled.mockReset();
  mocks.isReduceMotionEnabled.mockResolvedValue(false);
});

describe('haptics — reduce-motion awareness', () => {
  it('module registers a reduceMotionChanged listener on import', () => {
    expect(mocks.addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
  });

  it('forwards every haptic type to the native API when reduce motion is OFF', async () => {
    // shouldHaptic: true = fire haptics, false = skip
    const h = createHapticsController(() => true);
    await h.submitSuccess();
    await h.submitError();
    await h.offlineSave();
    await h.approvalAction();
    await h.selection();
    expect(mocks.notification).toHaveBeenCalledTimes(3);
    expect(mocks.impact).toHaveBeenCalledTimes(1);
    expect(mocks.selection).toHaveBeenCalledTimes(1);
  });

  it('forwards nothing when reduce motion is ON', async () => {
    const h = createHapticsController(() => false);
    await h.submitSuccess();
    await h.submitError();
    await h.offlineSave();
    await h.approvalAction();
    await h.selection();
    expect(mocks.notification).not.toHaveBeenCalled();
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.selection).not.toHaveBeenCalled();
  });

  it('updates the cache when the system reduce-motion event fires', () => {
    const eventCalls = mocks.addEventListener.mock.calls.filter(
      (c: unknown[]) => c[0] === 'reduceMotionChanged',
    );
    const handler = eventCalls[0]?.[1] as (v: boolean) => void;
    expect(handler).toBeDefined();
    expect(isReduceMotionEnabled()).toBe(false);
    handler(true);
    expect(isReduceMotionEnabled()).toBe(true);
    handler(false);
    expect(isReduceMotionEnabled()).toBe(false);
  });

  it('swallows errors from the native API so a missing module never crashes the UI', async () => {
    mocks.notification.mockRejectedValueOnce(new Error('no native module'));
    const h = createHapticsController(() => false);
    await expect(h.submitSuccess()).resolves.toBeUndefined();
  });
});
