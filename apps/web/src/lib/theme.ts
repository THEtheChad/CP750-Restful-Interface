/**
 * The colour theme: "dark" (the default, for a dim booth), "light", or "system" (follows the OS).
 * Kept in `localStorage` and applied as `data-theme` on <html>; index.html applies the stored
 * value before first paint. Storage can be unavailable, so every access is guarded.
 */
import { useSyncExternalStore } from "react";

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "cp750.theme";
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is Theme {
  return (THEMES as readonly unknown[]).includes(value);
}

export function getTheme(): Theme {
  const applied = globalThis.document?.documentElement.dataset.theme;
  if (isTheme(applied)) return applied;
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage refused: fall through to the default.
  }
  return "dark";
}

export function setTheme(theme: Theme): void {
  if (globalThis.document) globalThis.document.documentElement.dataset.theme = theme;
  try {
    globalThis.localStorage?.setItem(KEY, theme);
  } catch {
    // Storage refused: the theme lasts for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as Theme);
  return [theme, setTheme];
}
