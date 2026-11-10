import { afterEach } from "bun:test";
import { createServer } from "node:net";
import { builtinManifests, type Manifest } from "@cp750/manifests";
import {
  type Cp750Session,
  createCp750Session,
  type SessionEvent,
  type SessionOptions,
} from "../src/index.ts";
import { type MockCp750, type MockCp750Options, startMockCp750 } from "../src/mock/index.ts";

export function builtin(firmware: string): Manifest {
  const found = builtinManifests().find((m) => m.firmware === firmware);
  if (!found) throw new Error(`no built-in ${firmware}`);
  return found;
}

export const V1 = "1.0.0.150183";
export const V128 = "1.2.8.3";

/** Fast timings for tests. */
export const FAST: Pick<SessionOptions, "timeouts" | "reconnect"> = {
  timeouts: { connectMs: 500, commandMs: 300, idleMs: 20, blankGraceMs: 10 },
  reconnect: { initialDelayMs: 20, maxDelayMs: 100 },
};

export interface CapturingLogger {
  warn(message: string): void;
  debug(message: string): void;
  warnings: string[];
}

export function capturingLogger(): CapturingLogger {
  const warnings: string[] = [];
  return { warnings, warn: (m) => warnings.push(m), debug: () => {} };
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export function onCleanup(fn: () => Promise<void> | void): void {
  cleanups.push(fn);
}

export async function mock(options: Partial<MockCp750Options> = {}): Promise<MockCp750> {
  const device = await startMockCp750({ manifest: builtin(V1), ...options });
  onCleanup(() => device.close());
  return device;
}

export interface Harness {
  session: Cp750Session;
  events: SessionEvent[];
  logger: CapturingLogger;
}

export async function session(
  device: { host: string; port: number },
  options: Partial<SessionOptions> = {},
  { connect = true } = {},
): Promise<Harness> {
  const logger = capturingLogger();
  const s = createCp750Session({
    host: device.host,
    port: device.port,
    logger,
    ...FAST,
    ...options,
  });
  const events: SessionEvent[] = [];
  s.subscribe((e) => events.push(e));
  onCleanup(() => s.close());
  if (connect) await s.connect();
  return { session: s, events, logger };
}

export async function waitFor(
  condition: () => boolean,
  { timeoutMs = 2000, message = "condition" } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await Bun.sleep(5);
  }
}

export interface ScriptedServer {
  host: string;
  port: number;
  /** Every non-empty line received, trimmed, in order. */
  received: string[];
}

/**
 * A bare TCP server for protocol edge cases the mock does not produce. `handle` gets each
 * non-empty command line (trimmed), its 1-based index, and a `send` that writes a reply line
 * (CRLF-terminated) after `delayMs`, but never before a line sent earlier on that connection.
 * `exit` is handled for `close()`.
 */
export async function scriptedServer(
  handle: (line: string, index: number, send: (text: string, delayMs?: number) => void) => void,
): Promise<ScriptedServer> {
  const received: string[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let chain: Promise<void> = Promise.resolve();
    socket.on("data", (data) => {
      buffer += data.toString("latin1");
      for (let end = buffer.search(/[\r\n]/); end >= 0; end = buffer.search(/[\r\n]/)) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line === "") continue;
        if (line === "exit") {
          socket.end();
          continue;
        }
        received.push(line);
        // Like the unit, answer in order: a reply never overtakes one scheduled before it.
        const send = (text: string, delayMs = 0) => {
          const at = Date.now() + delayMs;
          chain = chain
            .then(() => Bun.sleep(Math.max(0, at - Date.now())))
            .then(() => {
              if (!socket.destroyed) socket.write(`${text}\r\n`, "latin1");
            });
        };
        handle(line, received.length, send);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("no address");
  onCleanup(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { host: "127.0.0.1", port: address.port, received };
}

/** Awaits a promise that should reject and returns the error. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}
