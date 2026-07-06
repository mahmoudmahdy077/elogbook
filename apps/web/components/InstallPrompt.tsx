'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * InstallPrompt — Apple Health–inspired PWA install banner.
 *
 * Listens for the `beforeinstallprompt` event, shows a frosted-glass banner
 * at the bottom of the screen, and triggers the install flow on tap.
 * Auto-hides if the app is already installed (display-mode: standalone).
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
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '12px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        background: 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '0.5px solid rgba(60, 60, 67, 0.12)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* App icon */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: '#007AFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 20,
          color: 'white',
          fontWeight: 600,
        }}
      >
        📋
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: '#1C1C1E',
            lineHeight: 1.3,
          }}
        >
          Install E-Logbook
        </div>
        <div
          style={{
            fontSize: 13,
            color: '#8E8E93',
            lineHeight: 1.3,
          }}
        >
          Get offline access &amp; a faster experience
        </div>
      </div>

      {/* Install button */}
      <button
        onClick={handleInstall}
        aria-label="Install E-Logbook app"
        style={{
          background: '#007AFF',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: 20,
          padding: '8px 20px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
      >
        Install
      </button>

      {/* Dismiss X */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#8E8E93',
          fontSize: 20,
          cursor: 'pointer',
          padding: '4px 8px',
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ✕
      </button>

      {/* Bottom safe-area spacer */}
      <style jsx>{`
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          div[role='alert'] {
            padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
          }
        }
      `}</style>
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
