/**
 * M6/N7.2 — shared theme provider (system/light/dark + RTL).
 *
 * Default follows the system preference; the clinical identity stays light
 * unless the user picks dark. The override persists in AsyncStorage
 * (device-level UI preference, no identity/PHI). Direction follows the
 * active locale via I18nManager. A direction flip needs a restart to fully
 * relayout: `needsRestart` surfaces that instead of a half-RTL UI.
 * Status-bar contrast derives from the resolved theme.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { directionForLocale, type ThemeMode, type Direction } from './design-tokens';
import { parseThemeOverride, serializeThemeOverride, directionChanged, THEME_STORAGE_KEY } from './theme-store';
import { logWarn } from './logger';

export interface Theme {
  mode: ThemeMode;
  direction: Direction;
  locale: string;
  /** Restart required for a pending RTL direction flip to fully apply. */
  needsRestart: boolean;
  /** Persisted user override (null = follow system). */
  override: ThemeMode | null;
  setMode: (mode: ThemeMode | null) => void;
}

const ThemeContext = createContext<Theme>({
  mode: 'light', direction: 'ltr', locale: 'en', needsRestart: false, override: null, setMode: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [override, setOverrideState] = useState<ThemeMode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        const parsed = parseThemeOverride(raw);
        if (parsed) setOverrideState(parsed);
      } catch {
        // preference unreadable — fall back to system
      }
    })();
  }, []);

  const setMode = (mode: ThemeMode | null) => {
    setOverrideState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, serializeThemeOverride(mode)).catch(() => undefined);
  };

  const theme = useMemo<Theme>(() => {
    const mode: ThemeMode = override ?? (system === 'dark' ? 'dark' : 'light');
    const locales = Localization.getLocales?.() ?? [];
    const locale = locales[0]?.languageTag ?? locales[0]?.languageCode ?? 'en';
    const direction = directionForLocale(locale);
    const applied: Direction = I18nManager.isRTL ? 'rtl' : 'ltr';
    return { mode, direction, locale, needsRestart: directionChanged(applied, direction), override, setMode };
  }, [override, system]);

  useEffect(() => {
    const rtl = theme.direction === 'rtl';
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
      if (theme.needsRestart) logWarn('theme.rtl-restart-required');
    }
  }, [theme.direction, theme.needsRestart]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
