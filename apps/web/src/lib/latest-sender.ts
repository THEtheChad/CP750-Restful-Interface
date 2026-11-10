/**
 * Sends the latest of a stream of values (a fader being dragged) without building a backlog:
 *
 * - at most one send is in flight;
 * - a new value replaces any value still waiting, so only the newest is ever sent;
 * - sends are spaced at least `intervalMs` apart while values keep coming (throttle);
 * - `flush()` (pointer/key release) sends the waiting value as soon as nothing is in flight.
 *
 * Errors are the caller's business: `send` should handle its own rejections.
 */
export interface Scheduler {
  now(): number;
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export interface LatestSenderOptions<T> {
  send: (value: T) => Promise<unknown>;
  intervalMs?: number;
  scheduler?: Scheduler;
  /** Called when the last send settled and nothing is waiting. */
  onIdle?: () => void;
}

export interface LatestSender<T> {
  push(value: T): void;
  flush(): void;
  /** Drops the waiting value (an in-flight send still completes). */
  cancel(): void;
  /** True while a send is in flight or a value is waiting. */
  readonly busy: boolean;
}

export const DEFAULT_THROTTLE_MS = 150;

export function createLatestSender<T>(options: LatestSenderOptions<T>): LatestSender<T> {
  const { send, intervalMs = DEFAULT_THROTTLE_MS, scheduler = realScheduler, onIdle } = options;
  let waiting: { value: T } | null = null;
  let inFlight = false;
  let urgent = false;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let cancelTimer: (() => void) | null = null;

  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const pump = () => {
    if (inFlight || waiting === null) return;
    const wait = lastSentAt + intervalMs - scheduler.now();
    if (wait > 0 && !urgent) {
      cancelTimer ??= scheduler.schedule(() => {
        cancelTimer = null;
        pump();
      }, wait);
      return;
    }
    clearTimer();
    const { value } = waiting;
    waiting = null;
    urgent = false;
    inFlight = true;
    lastSentAt = scheduler.now();
    let settled: Promise<unknown>;
    try {
      settled = Promise.resolve(send(value));
    } catch (error) {
      settled = Promise.reject(error);
    }
    settled
      .catch(() => {})
      .then(() => {
        inFlight = false;
        pump();
        if (!inFlight && waiting === null) onIdle?.();
      });
  };

  return {
    push(value) {
      waiting = { value };
      pump();
    },
    flush() {
      if (waiting === null) return;
      urgent = true;
      pump();
    },
    cancel() {
      waiting = null;
      urgent = false;
      clearTimer();
    },
    get busy() {
      return inFlight || waiting !== null;
    },
  };
}
