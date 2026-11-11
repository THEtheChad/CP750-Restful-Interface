import { useCallback, useEffect, useState } from "react";

export const VIEWS = ["home", "advanced", "eq", "settings"] as const;
export type View = (typeof VIEWS)[number];

/** Older links: `#controls` was the home view. */
const ALIASES: Record<string, View> = { controls: "home" };

function readHash(): View {
  const hash = globalThis.location?.hash.replace(/^#\/?/, "") ?? "";
  if ((VIEWS as readonly string[]).includes(hash)) return hash as View;
  return ALIASES[hash] ?? "home";
}

/** The current view, kept in the URL hash (`#advanced`) so reloads and Back work. */
export function useHashView(): [View, (view: View) => void] {
  const [view, setViewState] = useState<View>(readHash);
  useEffect(() => {
    const onChange = () => setViewState(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const setView = useCallback((next: View) => {
    setViewState(next);
    const hash = next === "home" ? "" : `#${next}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", hash || window.location.pathname + window.location.search);
    }
  }, []);
  return [view, setView];
}
