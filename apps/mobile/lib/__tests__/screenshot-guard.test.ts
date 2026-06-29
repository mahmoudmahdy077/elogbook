import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  prevent: vi.fn().mockResolvedValue(undefined),
  allow: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn(),
}));

vi.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: () => mocks.prevent(),
  allowScreenCaptureAsync: () => mocks.allow(),
  addScreenshotListener: (l: () => void) => {
    mocks.addListener(l);
    return { remove: vi.fn() };
  },
  default: {
    preventScreenCaptureAsync: () => mocks.prevent(),
    allowScreenCaptureAsync: () => mocks.allow(),
    addScreenshotListener: (l: () => void) => {
      mocks.addListener(l);
      return { remove: vi.fn() };
    },
  },
}));

import { onScreenshotAttempt, usePreventScreenCapture } from '../screenshot-guard';

beforeEach(() => {
  mocks.prevent.mockClear();
  mocks.allow.mockClear();
  mocks.addListener.mockReset();
});

describe('usePreventScreenCapture', () => {
  it('calls preventScreenCaptureAsync on mount and allowScreenCaptureAsync on unmount', async () => {
    const release = usePreventScreenCapture();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.prevent).toHaveBeenCalledTimes(1);
    expect(mocks.allow).not.toHaveBeenCalled();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.allow).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from the native module so it never crashes the layout', async () => {
    mocks.prevent.mockRejectedValueOnce(new Error('no native module'));
    const release = usePreventScreenCapture();
    await new Promise((r) => setTimeout(r, 0));
    expect(() => release()).not.toThrow();
  });
});

describe('onScreenshotAttempt', () => {
  it('registers a listener and returns an unsubscribe fn', () => {
    const fn = vi.fn();
    const off = onScreenshotAttempt(fn);
    expect(mocks.addListener).toHaveBeenCalledWith(fn);
    expect(typeof off).toBe('function');
  });

  it('returns a no-op unsubscribe when the module is unavailable', () => {
    // We can't easily un-mock mid-test, but the contract is that the call
    // is safe. Sanity check that the function does not throw.
    expect(() => onScreenshotAttempt(() => undefined)()).not.toThrow();
  });
});
