/**
 * Sends the latest of a stream of values (a fader being dragged) without building a backlog:
 *
 * - at most one send is in flight;
 * - a new value replaces any value still waiting, so only the newest is ever sent;
 * - sends are spaced at least `intervalMs` apart while values keep coming (throttle);
 * - `flush()` (pointer/key release) sends the waiting value as soon as nothing is in flight;
 * - with `limit`, each send moves at most as far as `limit` allows: the target stays waiting and
 *   is approached one capped send at a time (a ramp), and dropped if a send makes no progress.
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
  /**
   * Returns the value to send now on the way to `target` (e.g. capped to a maximum step from the
   * device's current value). Defaults to `target` itself.
   */
  limit?: (target: T) => T;
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
  const {
    send,
    intervalMs = DEFAULT_THROTTLE_MS,
    scheduler = realScheduler,
    onIdle,
    limit,
  } = options;
  let waiting: { value: T } | null = null;
  /** The last capped send of the current ramp (reset by every new target). */
  let lastCapped: { value: T } | null = null;
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
    const target = waiting.value;
    const value = limit ? limit(target) : target;
    const capped = !Object.is(value, target);
    const wait = lastSentAt + intervalMs - scheduler.now();
    // `flush` skips the throttle for the final value, never for a capped step of a ramp.
    if (wait > 0 && (!urgent || capped)) {
      cancelTimer ??= scheduler.schedule(() => {
        cancelTimer = null;
        pump();
      }, wait);
      return;
    }
    clearTimer();
    if (!capped) {
      waiting = null;
      lastCapped = null;
    } else if (lastCapped && Object.is(value, lastCapped.value)) {
      // The same capped step again: the device did not follow the last one. Give up on the target.
      waiting = null;
      lastCapped = null;
      onIdle?.();
      return;
    } else {
      // A capped send leaves the target waiting; the rest of the ramp keeps the throttle.
      lastCapped = { value };
    }
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
      lastCapped = null;
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
