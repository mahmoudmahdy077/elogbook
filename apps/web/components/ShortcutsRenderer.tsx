'use client';

import dynamic from 'next/dynamic';
import { useShortcuts } from '@/lib/shortcuts';

const CommandPalette = dynamic(
  () => import('@/components/CommandPalette'),
  { ssr: false },
);

const KeyboardShortcutsHelp = dynamic(
  () => import('@/components/KeyboardShortcutsHelp'),
  { ssr: false },
);

export default function ShortcutsRenderer() {
  const { isPaletteOpen, isHelpOpen } = useShortcuts();

  return (
    <>
      {isPaletteOpen && <CommandPalette />}
      {isHelpOpen && <KeyboardShortcutsHelp />}
    </>
  );
}
