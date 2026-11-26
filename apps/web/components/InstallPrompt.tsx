'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * InstallPrompt — Apple Health–inspired PWA install banner.
 *
 * Listens for the `beforeinstallprompt` event, shows a frosted-glass banner
 * docked above the mobile tab bar, and triggers the install flow on tap.
 * Auto-hides if the app is already installed (display-mode: standalone).
 *
 * The banner is mobile-only: on a desktop viewport it has nothing to install
 * over and used to cover the bottom of the page at z-index 9999.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Already installed as a standalone PWA — don't show the prompt
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    ) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome === 'accepted') {
      setShowBanner(false);
    }

    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
  }, []);

  if (!showBanner) return null;

  return (
    <div
      role="region"
      aria-label="Install app"
      className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 border-t border-border bg-surface-raised px-4 py-3 backdrop-blur-xl md:hidden"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-primary text-text-on-primary">
        <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5v-9.6a1.5 1.5 0 00-.44-1.06l-3.4-3.4A1.5 1.5 0 0011.6 2H4.5zm7 1.9L14.6 7H12a.5.5 0 01-.5-.5V3.9zM6 10.75a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5a.75.75 0 01-.75-.75zm0 3a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-tight text-text-primary">Install E-Logbook</p>
        <p className="text-[13px] leading-tight text-text-muted">Offline access, one tap from the home screen</p>
      </div>

      <button
        onClick={handleInstall}
        aria-label="Install E-Logbook app"
        className="min-h-[44px] shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-text-on-primary transition-opacity hover:opacity-90"
      >
        Install
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text-muted hover:text-text-primary"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}

// Extend the WindowEventMap for beforeinstallprompt
declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
}
