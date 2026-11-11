import { type RefObject, useEffect, useState } from "react";

/** The element's content width, kept current with a ResizeObserver (`fallback` without one). */
export function useElementWidth(ref: RefObject<Element | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
