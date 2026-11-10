#!/usr/bin/env bun
/**
 * `cp750`: the command-line entry and the `bun build --compile` entry point.
 *
 *   cp750 serve [--mock]                 run the HTTP API and the embedded web client
 *   cp750 capture --host <ip> [--out d]  record version/help/status and a draft manifest
 *   cp750 query <param>                  one-shot read
 */
import { parseArgs } from "node:util";
import type { Cp750Session } from "@cp750/device";
import { createApp, SERVER_VERSION } from "./app.ts";
import { writeCapture } from "./capture.ts";
import {
  CONFIG_FLAG_OPTIONS,
  ConfigError,
  isLoopback,
  loadConfig,
  SETTINGS,
  type ServerConfig,
} from "./config.ts";
import { WEB_ASSETS } from "./generated/web-assets.ts";
import { toReading } from "./reading.ts";
import { captureDevice, createSession } from "./session-factory.ts";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Resolves when the process should shut down (SIGINT/SIGTERM by default). */
  shutdownSignal?: () => Promise<string>;
}

const CONNECT_TIMEOUT_MS = 10_000;

const CLI_OPTIONS = {
  ...CONFIG_FLAG_OPTIONS,
  out: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

function usage(): string {
  const settings = SETTINGS.map((s) => {
    const flag = s.flag ? `--${s.flag}${s.type === "string" ? " <v>" : ""}` : "(env only)";
    return `  ${flag.padEnd(24)} ${s.env.padEnd(21)} ${s.description} [${s.defaultLabel}]`;
  });
  return [
    `cp750 ${SERVER_VERSION}: REST + SSE gateway for the Dolby CP750`,
    "",
    "Usage:",
    "  cp750 serve [--mock] [options]         run the HTTP API and web client",
    "  cp750 capture --host <ip> [--out <dir>] record version, help and status, and write",
    "                                         <dir>/<firmware>/{help.txt,status.txt,manifest.json}",
    "                                         (default dir ./captures)",
    "  cp750 query <param> [options]          read one parameter and print it as JSON",
    "  cp750 --help | --version",
    "",
    "Options (flag, environment variable, meaning [default]); flags override the environment:",
    ...settings,
    "  --host <v>               (same as --cp750-host)",
  ].join("\n");
}

function signals(): Promise<string> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve("SIGINT"));
    process.once("SIGTERM", () => resolve("SIGTERM"));
  });
}

function timestamped(write: (line: string) => void): (line: string) => void {
  return (line) => write(`${new Date().toISOString()} ${line}`);
}

/**
 * Waits for the session to connect. One-shot commands fail on the first failed attempt (or after
 * `ms`) instead of riding the session's reconnect loop.
 */
async function connectWithin(session: Cp750Session, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const failed = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Could not connect to the CP750 within ${ms / 1000} s`)),
      ms,
    );
    unsubscribe = session.on("connection", (event) => {
      if (event.error) reject(new Error(`Could not connect to the CP750: ${event.error.message}`));
    });
  });
  try {
    await Promise.race([session.connect(), failed]);
  } finally {
    clearTimeout(timer);
    unsubscribe?.();
  }
}

async function serve(config: ServerConfig, io: CliIo): Promise<number> {
  const log = timestamped(io.out);
  const handle = await createSession(config);
  const app = createApp({ session: handle.session, config, webAssets: WEB_ASSETS, log });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: config.listenHost,
      port: config.port,
      fetch: app.fetch,
      // Above the 15 s SSE heartbeat, so idle event streams stay open.
      idleTimeout: 60,
    });
  } catch (error) {
    await handle.close();
    io.err(`Cannot listen on ${config.listenHost}:${config.port}: ${(error as Error).message}`);
    return 1;
  }

  log(`cp750 ${SERVER_VERSION} listening on ${server.url.href}`);
  log(`device: ${handle.description}`);
  const flags = [
    config.readOnly && "read-only",
    config.allowFull && "full-tier allowed",
    config.allowInternal && "internal params allowed",
    config.apiToken ? "token required for changes" : "no API token",
  ].filter(Boolean);
  log(`mode: ${flags.join(", ")}`);
  if (Object.keys(WEB_ASSETS).length === 0) log("web client: not embedded in this build");
  if (!isLoopback(config.listenHost) && !config.apiToken && !config.readOnly) {
    io.err(
      `WARNING: listening on ${config.listenHost} without CP750_API_TOKEN; anyone who can reach this port can change the processor.`,
    );
  }

  handle.session.on("connection", (e) =>
    log(`connection: ${e.connection}${e.error ? ` (${e.error.message})` : ""}`),
  );
  handle.session.on("device", (e) =>
    log(
      `device: firmware ${e.firmware ?? "unknown"}, manifest ${e.manifest?.firmware ?? "none"} (${e.manifest?.match ?? "none"}${e.manifest?.verified ? ", verified" : ""})`,
    ),
  );
  handle.session.connect().catch((error: unknown) => log(`connect: ${String(error)}`));

  const signal = await (io.shutdownSignal ?? signals)();
  log(`${signal}: shutting down`);
  try {
    await handle.close();
  } finally {
    // `true` also ends open SSE streams, which would otherwise keep the server alive.
    await server.stop(true);
  }
  return 0;
}

async function query(config: ServerConfig, name: string, io: CliIo): Promise<number> {
  const handle = await createSession(config);
  try {
    await connectWithin(handle.session, CONNECT_TIMEOUT_MS);
    const result = await handle.session.read(name);
    io.out(JSON.stringify(toReading(handle.session, result)));
    return 0;
  } finally {
    await handle.close();
  }
}

async function capture(config: ServerConfig, outDir: string, io: CliIo): Promise<number> {
  io.err(`Capturing from ${config.cp750Host}:${config.cp750Port}…`);
  const result = await captureDevice({
    host: config.cp750Host,
    port: config.cp750Port,
    eol: config.eol,
    timeoutMs: CONNECT_TIMEOUT_MS,
  });
  const files = await writeCapture(outDir, result);
  io.out(`firmware ${result.firmware}: wrote ${files.help}, ${files.status}, ${files.manifest}`);
  return 0;
}

/** Runs the CLI. Returns the exit code. */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo = { out: console.log, err: console.error },
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof CLI_OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: CLI_OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    io.err(`${(error as Error).message}\nRun "cp750 --help" for usage.`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.out(SERVER_VERSION);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    io.out(usage());
    return values.help ? 0 : 2;
  }

  let config: ServerConfig;
  try {
    config = loadConfig(env, argv);
  } catch (error) {
    if (error instanceof ConfigError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }

  const expectArgs = (count: number, what: string): boolean => {
    if (rest.length === count) return true;
    io.err(`cp750 ${command}: expected ${what}\nRun "cp750 --help" for usage.`);
    return false;
  };

  try {
    switch (command) {
      case "serve":
        return expectArgs(0, "no arguments") ? await serve(config, io) : 2;
      case "query":
        return expectArgs(1, "one parameter name") ? await query(config, rest[0] as string, io) : 2;
      case "capture":
        return expectArgs(0, "no arguments")
          ? await capture(config, (values.out as string | undefined) ?? "./captures", io)
          : 2;
      default:
        io.err(`Unknown command "${command}"\nRun "cp750 --help" for usage.`);
        return 2;
    }
  } catch (error) {
    io.err(`cp750 ${command}: ${(error as Error).message ?? String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
