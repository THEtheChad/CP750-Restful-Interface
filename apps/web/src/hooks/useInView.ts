import { type RefObject, useEffect, useState } from "react";

/**
 * True once the element has stayed on screen for `dwellMs`, so a fast scroll past hundreds of
 * rows doesn't read each of them. Stays true afterwards (the value is cached by then). Without
 * `IntersectionObserver` it stays false and reads happen on demand only.
 */
export function useInView(ref: RefObject<Element | null>, dwellMs = 300): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        clearTimeout(timer);
        if (visible) timer = setTimeout(() => setSeen(true), dwellMs);
      },
      { rootMargin: "64px 0px" },
    );
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref, dwellMs, seen]);
  return seen;
}
