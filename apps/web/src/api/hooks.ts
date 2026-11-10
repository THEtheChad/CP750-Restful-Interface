/** React hooks over the gateway API and the TanStack Query cache. */
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useSyncExternalStore } from "react";
import { blockReason } from "../lib/reasons.ts";
import { ApiContext, type ApiContextValue, StreamStatusContext } from "./context.ts";
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
): void {
  queryClient.setQueryData<ParamReading>(queryKeys.param(name), (old) => {
    const { db: _db, ...rest } = old ?? { name };
    return { ...rest, name, value, raw };
  });
}

interface WriteVariables {
  value: ParamValue;
  confirm?: boolean;
}

/**
 * Writes a param optimistically. On failure the cache rolls back, except for `WRITE_REJECTED`
 * (422), where it takes the value the processor kept.
 */
export function useWriteParam(name: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = queryKeys.param(name);
  return useMutation<ParamReading, ApiError, WriteVariables, { previous?: ParamReading }>({
    mutationKey: ["write", name],
    mutationFn: ({ value, confirm }) => api.writeParam(name, value, confirm),
    onMutate: async ({ value }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ParamReading>(key);
      setReadingValue(queryClient, name, value);
      return { previous };
    },
    onError: (error, _variables, context) => {
      const { problem } = error;
      if (problem.code === "WRITE_REJECTED" && problem.actual !== undefined) {
        setReadingValue(queryClient, name, problem.actual, problem.raw);
        if (context?.previous?.unit === "fader")
          void queryClient.invalidateQueries({ queryKey: key });
      } else if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onSuccess: (reading) => {
      queryClient.setQueryData(key, reading);
    },
  });
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
