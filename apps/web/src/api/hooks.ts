/** React hooks over the gateway API and the TanStack Query cache. */
import {
  type QueryClient,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { blockReason } from "../lib/reasons.ts";
import { ApiContext, type ApiContextValue, StreamStatusContext } from "./context.ts";
import { beginWrite, endWrite, pendingWrites } from "./pending-writes.ts";
import type { ApiError } from "./problem.ts";
import { queryKeys } from "./query-keys.ts";
import type { ActionResult, Command, Device, ParamReading, ParamValue } from "./types.ts";

function useApiContext(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error("useApi must be used inside <AppProviders>");
  return value;
}

export function useApi() {
  return useApiContext().api;
}

export function useTokenStore() {
  return useApiContext().tokens;
}

export function useToken(): string | null {
  const tokens = useTokenStore();
  return useSyncExternalStore(tokens.subscribe, tokens.get, tokens.get);
}

export function useStreamStatus() {
  return useContext(StreamStatusContext);
}

export function useDevice() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.device, queryFn: () => api.getDevice() });
}

export function useCommands() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.commands,
    queryFn: () => api.listCommands(),
    // Refreshed by `device`/`connection` events; no processor traffic either way.
    staleTime: 60_000,
  });
}

export function useCommand(name: string): Command | undefined {
  const { data } = useCommands();
  return data?.commands.find((c) => c.name === name);
}

export interface UseParamOptions {
  enabled: boolean;
  /** Re-read on mount and window focus (main controls), or keep until refreshed (advanced). */
  live?: boolean;
}

/** Reads one param from the processor. Only runs while `enabled`. */
export function useParam(name: string, { enabled, live = false }: UseParamOptions) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.param(name),
    queryFn: () => api.readParam(name),
    enabled,
    staleTime: live ? 0 : Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: live,
  });
}

export interface ParamAccess {
  command: Command | undefined;
  device: Device | undefined;
  /** Why each operation is disabled right now; `null` when it is allowed. */
  read: string | null;
  write: string | null;
  action: string | null;
}

/** What the operator may do with `name` right now, and why not. */
export function useParamAccess(name: string): ParamAccess {
  const device = useDevice().data;
  const command = useCommand(name);
  const hasToken = useToken() !== null;
  const context = { device, hasToken };
  return {
    command,
    device,
    read: blockReason(command, "read", context),
    write: blockReason(command, "write", context),
    action: blockReason(command, "action", context),
  };
}

function setReadingValue(
  queryClient: QueryClient,
  name: string,
  value: ParamValue,
  raw = String(value),
): ParamReading | undefined {
  return queryClient.setQueryData<ParamReading>(queryKeys.param(name), (old) => {
    const { db: _db, ...rest } = old ?? { name };
    return { ...rest, name, value, raw };
  });
}

interface WriteVariables {
  value: ParamValue;
  confirm?: boolean;
}

interface WriteContext {
  previous?: ParamReading;
  /** The exact object this write put in the cache, to tell whether something replaced it since. */
  optimistic?: ParamReading;
}

/** Mutation key of every write to `name` (for `useIsMutating`). */
export const writeKey = (name: string) => ["write", name] as const;

/**
 * Writes a param optimistically. Writes to one param run one at a time, in order (mutation
 * scope). On failure the cache rolls back, or takes the value the processor kept on
 * `WRITE_REJECTED` (422), but only while it still holds this write's optimistic value: if
 * something newer replaced it (another write, a re-read), the param is re-read instead. SSE
 * `param` events for it are held back until its writes settle (see `pending-writes.ts`).
 */
export function useWriteParam(name: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.param(name);
  return useMutation<ParamReading, ApiError, WriteVariables, WriteContext>({
    mutationKey: writeKey(name),
    scope: { id: `param:${name}` },
    mutationFn: ({ value, confirm }) => api.writeParam(name, value, confirm),
    onMutate: async ({ value }) => {
      beginWrite(queryClient, name);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ParamReading>(key);
      const optimistic = setReadingValue(queryClient, name, value);
      return { previous, optimistic };
    },
    onError: (error, _variables, context) => {
      const current = queryClient.getQueryData<ParamReading>(key);
      if (!context?.optimistic || current !== context.optimistic) {
        void queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      const { problem } = error;
      if (problem.code === "WRITE_REJECTED" && problem.actual !== undefined) {
        setReadingValue(queryClient, name, problem.actual, problem.raw);
        if (context.previous?.unit === "fader")
          void queryClient.invalidateQueries({ queryKey: key });
      } else if (context.previous) {
        queryClient.setQueryData(key, context.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onSuccess: (reading) => {
      // A later, still pending write's optimistic value wins over this one's result.
      if (pendingWrites(queryClient, name) <= 1) queryClient.setQueryData(key, reading);
    },
    onSettled: () => {
      const held = endWrite(queryClient, name);
      const current = queryClient.getQueryData<ParamReading>(key);
      // An event arrived while writing and disagrees with where we ended up: ask the processor.
      if (held && !Object.is(held.value, current?.value)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** True while any write to `name` is in flight or queued. */
export function useWritePending(name: string): boolean {
  return useIsMutating({ mutationKey: writeKey(name) }) > 0;
}

/** Re-renders every `ms` and returns the current time. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** How long a value may go without confirmation before it is shown as stale, given `pollMs`. */
export function staleAfterMs(pollMs: number): number {
  return pollMs > 0 ? Math.max(3 * pollMs, 3_000) : 10_000;
}

export interface Freshness {
  /** True when the shown value may no longer match the processor. */
  stale: boolean;
  /** Why, for a tooltip or screen reader; `null` when fresh. */
  reason: string | null;
}

/**
 * Whether the cached value of a polled param (fader, mute, input) is still trustworthy. While the
 * event stream is open, the processor is connected and the gateway polls, every front-panel change
 * reaches the cache within one poll interval, so the value counts as confirmed "now". Otherwise
 * it is as old as its last read or event, and turns stale after a few poll intervals.
 */
export function useFreshness(name: string): Freshness {
  const queryClient = useQueryClient();
  const device = useDevice().data;
  const stream = useStreamStatus();
  const now = useNow(1_000);
  const lastLive = useRef(0);
  const pollMs = device?.pollMs ?? 0;
  const live = stream === "open" && device?.connection === "connected" && pollMs > 0;
  if (live) lastLive.current = now;
  const state = queryClient.getQueryState(queryKeys.param(name));
  if (!state?.dataUpdatedAt) return { stale: false, reason: null };
  const confirmedAt = Math.max(state.dataUpdatedAt, lastLive.current);
  if (now - confirmedAt <= staleAfterMs(pollMs)) return { stale: false, reason: null };
  const reason =
    pollMs === 0
      ? "The gateway does not poll (CP750_POLL_MS=0): front-panel changes are not shown."
      : stream !== "open"
        ? "Live updates from the gateway are interrupted."
        : "The processor is not connected.";
  return { stale: true, reason };
}

interface ActionVariables {
  value?: ParamValue;
  confirm?: boolean;
}

export function useTriggerAction(name: string) {
  const api = useApi();
  return useMutation<ActionResult, ApiError, ActionVariables>({
    mutationKey: ["action", name],
    mutationFn: (body) => api.triggerAction(name, body),
  });
}
