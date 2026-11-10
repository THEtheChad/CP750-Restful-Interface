/**
 * An in-memory stand-in for the gateway's HTTP API (as a `fetch`) and its SSE stream (as an
 * `EventSource` factory), so components run against the real client code.
 */
import type { EventSourceLike } from "../src/api/events.ts";
import type { Command, Device, ParamValue, Problem } from "../src/api/types.ts";
import { fixtureCommands, fixtureDevice } from "./fixtures.ts";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

type Handler = (request: RecordedRequest) => Response | undefined | Promise<Response | undefined>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}

export function problem(
  status: number,
  code: Problem["code"],
  extra: Partial<Problem> = {},
): Response {
  const title = extra.title ?? code;
  return json(
    {
      type: `urn:cp750:problem:${code.toLowerCase()}`,
      title,
      status,
      detail: title,
      code,
      ...extra,
    },
    status,
  );
}

/** The piecewise fader curve (0 dB at raw 70), for readings. */
/** A promise you resolve later: hold a response open to observe optimistic state. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function faderDb(raw: number): number {
  const db = raw <= 40 ? -90 + raw * 2 : -10 + ((raw - 40) * 20) / 60;
  return Math.round(db * 100) / 100;
}

export interface FakeGatewayOptions {
  device?: Partial<Device>;
  commands?: Command[];
  values?: Record<string, ParamValue>;
}

export function createFakeGateway(options: FakeGatewayOptions = {}) {
  const device = fixtureDevice(options.device);
  const commands = options.commands ?? fixtureCommands();
  const values = new Map<string, ParamValue>(
    Object.entries({
      "cp750.sys.fader": 70,
      "cp750.sys.mute": 0,
      "cp750.sys.input_mode": "dig_1",
      "cp750.sys.mute_fade_in": 500,
      "cp750.sys.lip_sync_delay_offset": 0,
      "cp750.sys.hostname": "booth-1",
      "cp750.state.dig_1_present": 1,
      "cp750.sysinfo.version": "1.2.8.3",
      ...options.values,
    }),
  );
  const requests: RecordedRequest[] = [];
  const overrides: Handler[] = [];

  const reading = (name: string) => {
    const spec = commands.find((c) => c.name === name);
    const value = values.get(name);
    if (value === undefined) return problem(404, "UNKNOWN_PARAMETER", { param: name });
    return json({
      name,
      value,
      raw: String(value),
      ...(spec?.unit ? { unit: spec.unit } : {}),
      ...(spec?.unit === "fader" ? { db: faderDb(Number(value)) } : {}),
    });
  };

  const route = (r: RecordedRequest): Response => {
    if (r.method === "GET" && r.path === "/api/device") return json(device);
    if (r.method === "GET" && r.path === "/api/commands") {
      return json({ firmware: device.firmware, manifest: device.manifest, commands });
    }
    const param = /^\/api\/params\/(.+)$/.exec(r.path);
    if (param) {
      const name = decodeURIComponent(param[1] as string);
      if (r.method === "GET") return reading(name);
      if (r.method === "PUT") {
        values.set(name, (r.body as { value: ParamValue }).value);
        return reading(name);
      }
    }
    const action = /^\/api\/actions\/(.+)$/.exec(r.path);
    if (action && r.method === "POST") {
      const name = decodeURIComponent(action[1] as string);
      const value = (r.body as { value?: ParamValue } | null)?.value ?? 1;
      return json({ name, value, raw: String(value) });
    }
    return problem(404, "NOT_FOUND");
  };

  const fetchImpl = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const recorded: RecordedRequest = {
      method: request.method,
      path: url.pathname,
      body: text ? JSON.parse(text) : null,
      authorization: request.headers.get("authorization"),
    };
    requests.push(recorded);
    for (const handler of overrides) {
      const response = await handler(recorded);
      if (response) return response;
    }
    return route(recorded);
  };

  return {
    device,
    commands,
    values,
    requests,
    fetch: fetchImpl,
    /** Answers matching requests with `handler` first (return `undefined` to fall through). */
    intercept(handler: Handler) {
      overrides.push(handler);
    },
    /** Requests other than the device/commands bootstrap. */
    paramRequests(method?: string) {
      return requests
        .filter((r) => r.path.startsWith("/api/params/") || r.path.startsWith("/api/actions/"))
        .filter((r) => !method || r.method === method);
    },
  };
}

export type FakeGateway = ReturnType<typeof createFakeGateway>;

/** A controllable `EventSource`. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error("no EventSource was created");
    return last;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export const createFakeEventSource = (url: string) => new FakeEventSource(url);
