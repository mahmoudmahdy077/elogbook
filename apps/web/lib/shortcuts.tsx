'use client';

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import SequenceIndicator from '@/components/SequenceIndicator';

// ─── Types ───────────────────────────────────────────────

export type Category = 'navigation' | 'actions' | 'list-navigation';

export interface ShortcutBinding {
  key: string;
  ctrlOrCmd?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  id: string;
  label: string;
  description?: string;
  category: Category;
  bindings: ShortcutBinding[];
  handler: () => void;
}

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  category: string;
  shortcut?: string;
  onSelect: () => void;
}

export type ModKey = '⌘' | 'Ctrl';

// ─── Sequence navigation map ────────────────────────────
// "G then D" -> Dashboard, "G then C" -> Cases, etc.

interface SequenceAction {
  id: string;
  label: string;
  href: string;
}

const SEQUENCE_MAP: Record<string, Record<string, SequenceAction>> = {
  g: {
    d: { id: 'go-dashboard', label: 'Go to Dashboard', href: '/dashboard' },
    c: { id: 'go-cases', label: 'Go to Cases', href: '/cases' },
    a: { id: 'go-approvals', label: 'Go to Approvals', href: '/approvals' },
    g: { id: 'go-goals', label: 'Go to Goals', href: '/goals' },
    r: { id: 'go-reports', label: 'Go to Reports', href: '/reports' },
  },
};

const SEQUENCE_TIMEOUT_MS = 1200;

// ─── Helpers ────────────────────────────────────────────

export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrlOrCmd) {
    const isMac = typeof navigator !== 'undefined'
      && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (binding.shift) parts.push('⇧');
  if (binding.alt) parts.push('⌥');
  parts.push(binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join(' + ');
}

export function getModKey(): ModKey {
  if (typeof navigator === 'undefined') return '⌘';
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}

// ─── Context ─────────────────────────────────────────────

interface ShortcutContextValue {
  shortcuts: ShortcutDef[];
  registerShortcut: (shortcut: ShortcutDef) => () => void;
  unregisterShortcut: (id: string) => void;
  isSequenceMode: boolean;
  sequenceKeys: string[];
  isHelpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  isPaletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  modKey: ModKey;
  paletteItems: CommandPaletteItem[];
  cancelSequence: () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcuts() {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error('useShortcuts must be used within KeyboardShortcutsProvider');
  return ctx;
}

// ─── Default shortcut factory ───────────────────────────

function createDefaultShortcuts(
  navigate: (href: string) => void,
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>,
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>,
): ShortcutDef[] {
  return [
    {
      id: 'new-case',
      label: 'New Case',
      category: 'actions' as Category,
      bindings: [{ key: 'n', ctrlOrCmd: true }],
      handler: () => navigate('/cases/new'),
    },
    {
      id: 'command-palette',
      label: 'Command Palette',
      category: 'actions' as Category,
      bindings: [{ key: 'k', ctrlOrCmd: true }],
      handler: () => setPaletteOpen((prev) => !prev),
    },
    {
      id: 'shortcuts-help',
      label: 'Keyboard Shortcuts',
      category: 'actions' as Category,
      bindings: [{ key: '?' }],
      handler: () => setHelpOpen((prev) => !prev),
    },
  ];
}

// ─── Provider ────────────────────────────────────────────

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>([]);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [sequenceKeys, setSequenceKeys] = useState<string[]>([]);
  const [isSequenceMode, setIsSequenceMode] = useState(false);
  const sequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shortcutRegistry = useRef<Map<string, ShortcutDef>>(new Map());
  const [ready, setReady] = useState(false);

  const modKey = useMemo(() => getModKey(), []);

  // Extract tenant slug from the current pathname so navigation
  // shortcuts work within the authenticated layout scope.
  const tenantSlug = useMemo(() => {
    if (!pathname) return undefined;
    const segments = pathname.split('/').filter(Boolean);
    // Path is like /{tenant}/dashboard or /{tenant}/cases/new
    // We check if the first segment looks like a tenant slug (not a known top-level path)
    const topLevelPaths = new Set(['login', 'onboarding', 'mfa', 'api-docs']);
    if (segments.length > 0 && !topLevelPaths.has(segments[0])) {
      return segments[0];
    }
    return undefined;
  }, [pathname]);

  const navigate = useCallback(
    (href: string) => {
      const path = tenantSlug ? `/${tenantSlug}${href}` : href;
      router.push(path);
    },
    [router, tenantSlug],
  );

  const cancelSequence = useCallback(() => {
    setIsSequenceMode(false);
    setSequenceKeys([]);
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
      sequenceTimeoutRef.current = null;
    }
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    shortcutRegistry.current.delete(id);
    setShortcuts(Array.from(shortcutRegistry.current.values()));
  }, []);

  const registerShortcut = useCallback((shortcut: ShortcutDef) => {
    if (shortcutRegistry.current.has(shortcut.id)) {
      return () => unregisterShortcut(shortcut.id);
    }
    shortcutRegistry.current.set(shortcut.id, shortcut);
    setShortcuts(Array.from(shortcutRegistry.current.values()));
    return () => {
      shortcutRegistry.current.delete(shortcut.id);
      setShortcuts(Array.from(shortcutRegistry.current.values()));
    };
  }, [unregisterShortcut]);

  // Register default shortcuts on mount
  useEffect(() => {
    const defaults = createDefaultShortcuts(navigate, setPaletteOpen, setHelpOpen);
    const unregisterFns = defaults.map((d) => registerShortcut(d));
    setReady(true);
    return () => {
      unregisterFns.forEach((fn) => fn());
    };
  }, [navigate, registerShortcut]);

  // Sequence timeout cleanup
  useEffect(() => {
    return () => {
      if (sequenceTimeoutRef.current) {
        clearTimeout(sequenceTimeoutRef.current);
      }
    };
  }, []);

  // Global keydown handler
  useEffect(() => {
    if (!ready) return;

    const allShortcuts = Array.from(shortcutRegistry.current.values());

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Always allow Escape to close dialogs / cancel sequences
      if (e.key === 'Escape') {
        if (isSequenceMode) {
          cancelSequence();
          e.preventDefault();
          return;
        }
        if (isHelpOpen) {
          setHelpOpen(false);
          e.preventDefault();
          return;
        }
        if (isPaletteOpen) {
          setPaletteOpen(false);
          e.preventDefault();
          return;
        }
        return;
      }

      // In sequence mode — waiting for second key
      if (isSequenceMode) {
        const secondKey = e.key.toLowerCase();
        const action = SEQUENCE_MAP['g']?.[secondKey];
        if (action) {
          e.preventDefault();
          navigate(action.href);
          cancelSequence();
          return;
        }
        // Any other key cancels the sequence
        e.preventDefault();
        cancelSequence();
        return;
      }

      // Don't fire shortcuts when typing in editable elements
      if (isInput) return;

      // Check chord shortcuts (Cmd+N, Cmd+K, ?, J, K)
      for (const shortcut of allShortcuts) {
        for (const binding of shortcut.bindings) {
          const matchKey = e.key.toLowerCase() === binding.key.toLowerCase();
          const ctrlOrCmdPressed = e.metaKey || e.ctrlKey;
          const matchCtrl = binding.ctrlOrCmd
            ? ctrlOrCmdPressed
            : !ctrlOrCmdPressed;
          const matchShift = binding.shift ? e.shiftKey : !e.shiftKey;
          const matchAlt = binding.alt ? e.altKey : !e.altKey;

          if (matchKey && matchCtrl && matchShift && matchAlt) {
            e.preventDefault();
            e.stopPropagation();
            shortcut.handler();
            return;
          }
        }
      }

      // Check for sequence start — standalone 'g' key (not in an input, not with modifiers)
      if (
        e.key.toLowerCase() === 'g' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !isInput
      ) {
        e.preventDefault();
        setIsSequenceMode(true);
        setSequenceKeys(['g']);
        sequenceTimeoutRef.current = setTimeout(() => {
          cancelSequence();
        }, SEQUENCE_TIMEOUT_MS);
        return;
      }

      // J / K for list navigation
      if (
        (e.key === 'j' || e.key === 'J') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        // Dispatch a custom event that list views can listen to
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:list-next'));
        return;
      }
      if (
        (e.key === 'k' || e.key === 'K') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:list-prev'));
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [ready, isHelpOpen, isPaletteOpen, isSequenceMode, cancelSequence, navigate]);

  // Access allShortcuts ref inside useMemo
  const allShortcuts = shortcuts;

  // Build palette items from shortcuts + sequence map
  const paletteItems: CommandPaletteItem[] = useMemo(() => {
    const items: CommandPaletteItem[] = allShortcuts.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      category:
        s.category === 'navigation'
          ? 'Navigation'
          : s.category === 'actions'
            ? 'Actions'
            : 'List Navigation',
      shortcut: s.bindings.map((b) => formatBinding(b)).join(', '),
      onSelect: s.handler,
    }));

    // Add sequence navigation items
    for (const secondKeys of Object.values(SEQUENCE_MAP)) {
      for (const [secondKey, action] of Object.entries(secondKeys)) {
        if (!items.some((i) => i.id === action.id)) {
          items.push({
            id: action.id,
            label: action.label,
            category: 'Navigation',
            shortcut: `G then ${secondKey.toUpperCase()}`,
            onSelect: () => navigate(action.href),
          });
        }
      }
    }

    return items;
  }, [allShortcuts, navigate]);

  return (
    <ShortcutContext.Provider
      value={{
        shortcuts: allShortcuts,
        registerShortcut,
        unregisterShortcut,
        isSequenceMode,
        sequenceKeys,
        isHelpOpen,
        setHelpOpen,
        isPaletteOpen,
        setPaletteOpen,
        modKey,
        paletteItems,
        cancelSequence,
      }}
    >
      {children}
      {isSequenceMode && <SequenceIndicator keys={sequenceKeys} modKey={modKey} />}
    </ShortcutContext.Provider>
  );
}
