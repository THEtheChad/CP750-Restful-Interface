import { afterEach } from "bun:test";
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
