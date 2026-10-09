/**
 * ThemeContext -- React Context for theme palette and light/dark mode.
 *
 * State:
 *   - theme: palette slug (always DEFAULT_THEME in production — single-theme)
 *   - mode: "light" | "dark" | "system"
 *   - resolvedMode: actual applied mode ("light" | "dark")
 *
 * Persistence: localStorage, keys from STORAGE_KEYS (THEME / MODE) — the same
 * SSOT the zero-flash bridge in _document.tsx reads (no key drift = no FOUC).
 * Effect: sets data-theme, data-mode, color-scheme on <html>.
 *
 * Default theme: "rouge-papier" (sole production palette since 2026-09-06;
 * charcoal-gold before that, retired by the owner's vote S105/S106).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';

/* ─── Constants ─── */
/** The only palette with a block in palettes.css; exported so no consumer
 * repeats the slug as a literal. */
export const DEFAULT_THEME = 'rouge-papier';
const DEFAULT_MODE = 'system' as const;
// SSOT — same key names the zero-flash bridge in _document.tsx reads, so the
// pre-hydration script and this provider can never drift (drift = FOUC).
const LS_KEY_THEME = STORAGE_KEYS.THEME;
const LS_KEY_MODE = STORAGE_KEYS.MODE;

/* ─── Types ─── */
type Mode = 'light' | 'dark' | 'system';
type ResolvedMode = 'light' | 'dark';

interface ThemeContextValue {
  /** Current palette slug */
  readonly theme: string;
  /** User preference: light, dark, or system */
  readonly mode: Mode;
  /** Actual applied mode after resolving "system" */
  readonly resolvedMode: ResolvedMode;
  /** Change the palette */
  readonly setTheme: (slug: string) => void;
  /** Change light/dark/system preference */
  readonly setMode: (mode: Mode) => void;
}

/* ─── Context ─── */
const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ─── Helpers ─── */

/**
 * Only a slug that has a palette block may reach `data-theme`; anything else
 * (a stale or hand-edited localStorage value, e.g. `charcoal-gold` or a
 * `cand-*` candidate from the S105 vote) falls back to the default, otherwise
 * `<html>` would carry a theme with no tokens and the page would render
 * without colors. The mount effect below writes the repaired value back, so
 * the pre-paint bridge stops stamping the stale slug on the next load.
 */
function sanitizeTheme(slug: string): string {
  return slug === DEFAULT_THEME ? slug : DEFAULT_THEME;
}

function readLocalStorage(key: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    return getLocalStorage(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    setLocalStorage(key, value);
  } catch {
    /* quota exceeded or private browsing — silently ignore */
  }
}

const VALID_MODES: ReadonlyArray<Mode> = ['light', 'dark', 'system'];

function readStoredMode(): Mode {
  const raw = readLocalStorage(LS_KEY_MODE, DEFAULT_MODE);
  return VALID_MODES.find(valid => valid === raw) ?? DEFAULT_MODE;
}

function getSystemMode(): ResolvedMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveMode(mode: Mode): ResolvedMode {
  return mode === 'system' ? getSystemMode() : mode;
}

function applyToDOM(theme: string, resolved: ResolvedMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  html.setAttribute('data-mode', resolved);
  html.style.colorScheme = resolved;
}

/* ─── Provider ─── */

interface ThemeProviderProps {
  readonly children: React.ReactNode;
}

export function ThemeProviderComposition({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<string>(() =>
    sanitizeTheme(readLocalStorage(LS_KEY_THEME, DEFAULT_THEME))
  );

  const [mode, setModeState] = useState<Mode>(readStoredMode);

  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    resolveMode(mode)
  );

  /* Apply theme + mode to DOM whenever they change */
  useEffect(() => {
    const resolved = resolveMode(mode);
    setResolvedMode(resolved);
    applyToDOM(theme, resolved);
  }, [theme, mode]);

  /* Repair storage when the stored slug was rejected by sanitizeTheme: the
   * pre-paint bridge reads localStorage verbatim, so without this write-back a
   * rejected value would be stamped again on every reload before hydration. */
  useEffect(() => {
    if (readLocalStorage(LS_KEY_THEME, DEFAULT_THEME) !== theme) {
      writeLocalStorage(LS_KEY_THEME, theme);
    }
  }, [theme]);

  /* Listen for system preference changes when mode is "system" */
  useEffect(() => {
    if (mode !== 'system') {
      return;
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const resolved = resolveMode('system');
      setResolvedMode(resolved);
      applyToDOM(theme, resolved);
    };

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode, theme]);

  /* Follow a mode/theme change made in ANOTHER tab of the same origin. The
   * `storage` event fires only in the other tabs, so without this a tab left
   * open kept the old mode until reload, and its stale `mode` state was what it
   * would write back on the next toggle. State only: the value is already in
   * storage, the effect above re-applies it to <html>. */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LS_KEY_MODE) {
        setModeState(readStoredMode());
      } else if (event.key === LS_KEY_THEME) {
        setThemeState(
          sanitizeTheme(readLocalStorage(LS_KEY_THEME, DEFAULT_THEME))
        );
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((slug: string) => {
    const safe = sanitizeTheme(slug);
    setThemeState(safe);
    writeLocalStorage(LS_KEY_THEME, safe);
  }, []);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    writeLocalStorage(LS_KEY_MODE, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode, resolvedMode, setTheme, setMode }),
    [theme, mode, resolvedMode, setTheme, setMode]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/* ─── Hook ─── */

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
