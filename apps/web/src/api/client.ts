/**
 * The typed gateway client: openapi-fetch over the generated `paths`, unwrapped so each call
 * returns its data or throws an `ApiError` carrying the problem details.
 */
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema.ts";
import { ApiError, networkProblem, toProblem } from "./problem.ts";
import type { TokenStore } from "./token-store.ts";
import type {
  ActionResult,
  Commands,
  Device,
  ParamReading,
  ParamValue,
  SessionEvent,
} from "./types.ts";

export interface ApiOptions {
  /** Defaults to the page's origin (the gateway serves this client). */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: (request: Request) => Promise<Response>;
  tokens?: TokenStore;
}

export interface Api {
  getDevice(): Promise<Device>;
  listCommands(): Promise<Commands>;
  readParam(name: string): Promise<ParamReading>;
  writeParam(name: string, value: ParamValue, confirm?: boolean): Promise<ParamReading>;
  triggerAction(
    name: string,
    body?: { value?: ParamValue; confirm?: boolean },
  ): Promise<ActionResult>;
  /** URL of the SSE stream. */
  readonly eventsUrl: string;
}

type Result<T> = { data?: T; error?: unknown; response: Response };

async function unwrap<T>(call: () => Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await call();
  } catch (error) {
    throw new ApiError(networkProblem(error));
  }
  const { data, error, response } = result;
  if (!response.ok || data === undefined) {
    throw new ApiError(toProblem(response.status, response.statusText, error));
  }
  return data;
}

export function createApi(options: ApiOptions = {}): Api {
  const baseUrl = options.baseUrl ?? globalThis.location?.origin ?? "";
  const tokens = options.tokens;
  const client = createClient<paths>({
    baseUrl,
    // Resolved per call so tests (and polyfills) can swap the global.
    fetch: options.fetch ?? ((input) => globalThis.fetch(input)),
  });
  client.use({
    onRequest({ request }) {
      const token = tokens?.get();
      if (token && request.method !== "GET" && request.method !== "HEAD") {
        request.headers.set("authorization", `Bearer ${token}`);
      }
      return request;
    },
  });
  const path = (name: string) => ({ params: { path: { name } } });

  return {
    eventsUrl: `${baseUrl}/api/events`,
    getDevice: () => unwrap(() => client.GET("/api/device")),
    listCommands: () => unwrap(() => client.GET("/api/commands")),
    readParam: (name) => unwrap(() => client.GET("/api/params/{name}", path(name))),
    writeParam: (name, value, confirm) =>
      unwrap(() =>
        client.PUT("/api/params/{name}", {
          ...path(name),
          body: confirm ? { value, confirm } : { value },
        }),
      ),
    triggerAction: (name, body = {}) =>
      unwrap(() => client.POST("/api/actions/{name}", { ...path(name), body })),
  };
}

/** Parses one SSE message's `data`; `null` for anything that is not a session event. */
export function parseSessionEvent(data: string): SessionEvent | null {
  try {
    const event = JSON.parse(data) as SessionEvent;
    if (
      event &&
      (event.type === "param" || event.type === "connection" || event.type === "device")
    ) {
      return event;
    }
  } catch {
    // Ignore malformed messages.
  }
  return null;
}
