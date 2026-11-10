import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { Api } from "../../api/client.ts";
import { ApiContext, type StreamStatus, StreamStatusContext } from "../../api/context.ts";
import { connectEvents, type EventSourceFactory } from "../../api/events.ts";
import { ApiError } from "../../api/problem.ts";
import type { TokenStore } from "../../api/token-store.ts";

/** Query defaults: reads retry only on network blips; writes never retry on their own. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          failures < 2 && error instanceof ApiError && error.code === "NETWORK",
      },
      mutations: { retry: false },
    },
  });
}

export interface AppProvidersProps {
  api: Api;
  tokens: TokenStore;
  queryClient: QueryClient;
  /** Defaults to the browser's `EventSource`. */
  createEventSource?: EventSourceFactory;
  children: ReactNode;
}

/** The API client, token store, query cache and the live SSE stream. */
export function AppProviders({
  api,
  tokens,
  queryClient,
  createEventSource,
  children,
}: AppProvidersProps) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  useEffect(
    () =>
      connectEvents({
        url: api.eventsUrl,
        queryClient,
        onStatus: setStatus,
        ...(createEventSource ? { createEventSource } : {}),
      }),
    [api, queryClient, createEventSource],
  );
  const context = useMemo(() => ({ api, tokens }), [api, tokens]);
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={context}>
        <StreamStatusContext.Provider value={status}>{children}</StreamStatusContext.Provider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}
