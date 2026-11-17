// The page's colour theme: "dark" (the default) or "light" (docs/frontend.md §11). The theme is
// the `data-theme` attribute on <html>, which switches the tokens in styles/theme.css. A first
// visit follows the system's setting; pressing the top bar's theme button picks one, which is
// remembered in this browser. index.html sets the attribute before the page draws, with the same
// rule, so the page never flashes the other theme.

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

/** Where a chosen theme is remembered. index.html reads the same key. */
export const THEME_KEY = "lcv-theme";

const SYSTEM_LIGHT = "(prefers-color-scheme: light)";

/** The theme to start with: the one chosen before, else the system's, else dark. */
export function initialTheme(stored: string | null, systemLight: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return systemLight ? "light" : "dark";
}

/** The theme remembered in this browser, or null. Storage can be blocked, so a failure is null. */
export function storedTheme(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) ?? null;
  } catch {
    return null;
  }
}

function remember(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

function systemLight(): boolean {
  return globalThis.matchMedia?.(SYSTEM_LIGHT).matches ?? false;
}

/** Puts the theme on <html>, so the tokens switch at once. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * The page's theme and a toggle. Until the person picks one, it follows the system's setting,
 * including a change made while the page is open. The attribute is set as part of the toggle,
 * before React renders, so anything reading the tokens during that render (the editor) sees the
 * new values.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => initialTheme(storedTheme(), systemLight()));

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const media = globalThis.matchMedia?.(SYSTEM_LIGHT);
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => {
      if (storedTheme() !== null) return; // a theme the person picked wins over the system's
      const next: Theme = e.matches ? "light" : "dark";
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    remember(next);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
