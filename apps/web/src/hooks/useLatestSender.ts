import { useEffect, useRef, useState } from "react";
import { createLatestSender, type LatestSender } from "../lib/latest-sender.ts";

/**
 * A `LatestSender` bound to the component's lifetime. `send` and `onIdle` may change between
 * renders; the latest ones are always used.
 */
export function useLatestSender<T>(
  send: (value: T) => Promise<unknown>,
  options: { intervalMs?: number; onIdle?: () => void } = {},
): LatestSender<T> {
  const sendRef = useRef(send);
  const idleRef = useRef(options.onIdle);
  sendRef.current = send;
  idleRef.current = options.onIdle;
  const [sender] = useState(() =>
    createLatestSender<T>({
      send: (value) => sendRef.current(value),
      onIdle: () => idleRef.current?.(),
      ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    }),
  );
  useEffect(() => () => sender.cancel(), [sender]);
  return sender;
}
