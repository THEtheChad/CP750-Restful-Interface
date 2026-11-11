import { type RefObject, useEffect, useState } from "react";

/**
 * One IntersectionObserver for every row that asks, instead of one each: hundreds of rows share
 * it. Callbacks are keyed by element.
 */
const callbacks = new Map<Element, (visible: boolean) => void>();
let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: "64px 0px" },
  );
  return shared;
}

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
    const io = observer();
    callbacks.set(element, (visible) => {
      clearTimeout(timer);
      if (visible) timer = setTimeout(() => setSeen(true), dwellMs);
    });
    io.observe(element);
    return () => {
      clearTimeout(timer);
      callbacks.delete(element);
      io.unobserve(element);
    };
  }, [ref, dwellMs, seen]);
  return seen;
}
