import { useCallback, useEffect, useState } from "react";

export const VIEWS = ["controls", "advanced"] as const;
export type View = (typeof VIEWS)[number];

function readHash(): View {
  const hash = globalThis.location?.hash.replace(/^#\/?/, "") ?? "";
  return (VIEWS as readonly string[]).includes(hash) ? (hash as View) : "controls";
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
    const hash = next === "controls" ? "" : `#${next}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", hash || window.location.pathname + window.location.search);
    }
  }, []);
  return [view, setView];
}
