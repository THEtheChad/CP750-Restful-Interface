import { createContext } from "react";
import type { Api } from "./client.ts";
import type { TokenStore } from "./token-store.ts";

export interface ApiContextValue {
  api: Api;
  tokens: TokenStore;
}

/** Provided by `AppProviders`. */
export const ApiContext = createContext<ApiContextValue | null>(null);

export type StreamStatus = "connecting" | "open" | "retrying";

/** The SSE stream's state, provided by `AppProviders`. */
export const StreamStatusContext = createContext<StreamStatus>("connecting");
