// expo-screen-capture is a native module; we wrap it so the rest of the app
// depends on a single, focused surface that's trivially mockable in tests.

type ScreenCaptureModule = {
  preventScreenCaptureAsync: () => Promise<void>;
  allowScreenCaptureAsync: () => Promise<void>;
  addScreenshotListener: (listener: () => void) => { remove: () => void };
};

type ScreenCaptureNamespace = {
  preventScreenCaptureAsync?: () => Promise<void>;
  allowScreenCaptureAsync?: () => Promise<void>;
  addScreenshotListener?: (listener: () => void) => { remove: () => void };
  default?: ScreenCaptureNamespace;
};

import * as ScreenCapture from 'expo-screen-capture';

const mod: ScreenCaptureModule | null = ((): ScreenCaptureModule | null => {
  const ns: ScreenCaptureNamespace =
    (ScreenCapture as unknown as ScreenCaptureNamespace).default ?? (ScreenCapture as unknown as ScreenCaptureNamespace);
  if (typeof ns?.preventScreenCaptureAsync !== 'function') return null;
  return {
    preventScreenCaptureAsync: ns.preventScreenCaptureAsync.bind(ns),
    allowScreenCaptureAsync: (ns.allowScreenCaptureAsync ?? (async () => undefined)).bind(ns),
    addScreenshotListener: (ns.addScreenshotListener ?? (() => ({ remove: () => undefined }))).bind(ns),
  };
})();

export function usePreventScreenCapture(): () => void {
  // Hook shape: caller calls it once at the top of a component to install
  // the protection for the lifetime of the screen. Returns an unmount fn.
  // The actual install happens at module load time below — the hook exists
  // for caller ergonomics and to make the intent explicit at the JSX site.
  // (No React state is needed because the protection is global.)
  if (mod) {
    mod.preventScreenCaptureAsync().catch(() => undefined);
  }
  return () => {
    if (mod) {
      mod.allowScreenCaptureAsync().catch(() => undefined);
    }
  };
}

export function onScreenshotAttempt(listener: () => void): () => void {
  if (!mod) return () => undefined;
  const sub = mod.addScreenshotListener(listener);
  return () => sub.remove();
}
