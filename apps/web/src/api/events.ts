/**
 * The one `EventSource` on `/api/events`, feeding the TanStack Query cache: `param` events update
 * `["param", name]`, `connection`/`device` events update `["device"]` and refresh the command list.
 * Reconnects with exponential backoff and resyncs what it may have missed.
 */
import type { QueryClient } from "@tanstack/react-query";
import { parseSessionEvent } from "./client.ts";
import type { StreamStatus } from "./context.ts";
import { holdIfWriting } from "./pending-writes.ts";
import { queryKeys } from "./query-keys.ts";
import type { Device, ParamReading, SessionEvent } from "./types.ts";

/** Structural equality for the small JSON payloads of `connection`/`device` events. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Updates the query cache for one session event. A `param` event for a param with a write in
 * flight is held back (the write settles it, see `useWriteParam`). `connection` and `device`
 * events that match the cache, like the snapshots the stream opens with, change nothing and
 * trigger no refetch.
 */
export function applySessionEvent(queryClient: QueryClient, event: SessionEvent): void {
  switch (event.type) {
    case "param": {
      if (holdIfWriting(queryClient, event.name, event.value)) return;
      const key = queryKeys.param(event.name);
      const old = queryClient.getQueryData<ParamReading>(key);
      if (old && Object.is(old.value, event.value)) {
        if (old.raw !== event.raw)
          queryClient.setQueryData<ParamReading>(key, { ...old, raw: event.raw });
        return;
      }
      // `db` belongs to the old value; drop it rather than show a stale level.
      const { db: _staleDb, ...rest } = old ?? { name: event.name };
      queryClient.setQueryData<ParamReading>(key, {
        ...rest,
        name: event.name,
        value: event.value,
        raw: event.raw,
      });
      // Events carry no dB; a fader on screen re-reads to get it from the API.
      if (old?.unit === "fader") {
        void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
      return;
    }
    case "connection": {
      const old = queryClient.getQueryData<Device>(queryKeys.device);
      // Not fetched yet: the first fetch (already under way) reads the current state.
      if (!old) return;
      if (old.connection === event.connection && sameJson(old.lastError, event.error)) return;
      queryClient.setQueryData<Device>(queryKeys.device, {
        ...old,
        connection: event.connection,
        lastError: event.error,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.device });
      if (event.connection === "connected") {
        // Values may have changed while the processor was unreachable.
        void queryClient.invalidateQueries({ queryKey: queryKeys.params, refetchType: "active" });
        void queryClient.invalidateQueries({ queryKey: queryKeys.commands });
      }
      return;
    }
    case "device": {
      const old = queryClient.getQueryData<Device>(queryKeys.device);
      if (!old) return;
      if (old.firmware === event.firmware && sameJson(old.manifest, event.manifest)) return;
      queryClient.setQueryData<Device>(queryKeys.device, {
        ...old,
        firmware: event.firmware,
        manifest: event.manifest,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.device });
      void queryClient.invalidateQueries({ queryKey: queryKeys.commands });
      return;
    }
  }
}

/** The parts of `EventSource` this module uses (so tests can pass a fake). */
export interface EventSourceLike {
  onopen: ((this: never, ev: Event) => unknown) | null;
  onerror: ((this: never, ev: Event) => unknown) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface EventStreamOptions {
  url: string;
  queryClient: QueryClient;
  createEventSource?: EventSourceFactory;
  onStatus?: (status: StreamStatus) => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable timer for tests. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

const EVENT_TYPES = ["param", "connection", "device"] as const;

/** Opens the stream; returns `close`. */
export function connectEvents(options: EventStreamOptions): () => void {
  const {
    url,
    queryClient,
    createEventSource = (u) => new EventSource(u) as unknown as EventSourceLike,
    onStatus,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    setTimer = (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
  } = options;

  let source: EventSourceLike | null = null;
  let failures = 0;
  let everOpened = false;
  let cancelRetry: (() => void) | null = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    onStatus?.("connecting");
    const es = createEventSource(url);
    source = es;
    es.onopen = () => {
      if (everOpened || failures > 0) {
        // Anything could have changed while we were away.
        void queryClient.invalidateQueries({ queryKey: queryKeys.device });
        void queryClient.invalidateQueries({ queryKey: queryKeys.commands });
        void queryClient.invalidateQueries({ queryKey: queryKeys.params, refetchType: "active" });
      }
      everOpened = true;
      failures = 0;
      onStatus?.("open");
    };
    es.onerror = () => {
      // Take over from the browser's own retry so backoff is ours and HTTP errors also retry.
      es.close();
      if (source !== es || closed) return;
      source = null;
      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** failures);
      failures++;
      onStatus?.("retrying");
      cancelRetry = setTimer(() => {
        cancelRetry = null;
        open();
      }, delay);
    };
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (message) => {
        const event = parseSessionEvent(message.data);
        if (event) applySessionEvent(queryClient, event);
      });
    }
  };

  open();
  return () => {
    closed = true;
    cancelRetry?.();
    source?.close();
    source = null;
  };
}
