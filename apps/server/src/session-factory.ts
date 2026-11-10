/**
 * The only place the server constructs sessions. Everything else codes against the
 * `Cp750Session` contract.
 */
import {
  type Cp750Session,
  captureDevice as captureFromDevice,
  createCp750Session,
  type SessionOptions,
} from "@cp750/device";
import { startMockCp750 } from "@cp750/device/mock";
import { loadManifests, type Manifest } from "@cp750/manifests";
import type { ServerConfig } from "./config.ts";

export interface SessionHandle {
  session: Cp750Session;
  /** One line for the startup log, e.g. `CP750 at 192.168.1.136:61408`. */
  description: string;
  /** Closes the session and anything started with it (e.g. the mock device). */
  close(): Promise<void>;
}

/** Maps the server config to the real session's options. */
export function sessionOptions(config: ServerConfig): SessionOptions {
  return {
    host: config.cp750Host,
    port: config.cp750Port,
    eol: config.eol,
    allowFull: config.allowFull,
    allowInternal: config.allowInternal,
    readOnly: config.readOnly,
    ...(config.pollMs ? { pollIntervalMs: config.pollMs } : {}),
    ...(config.manifestDir ? { manifestDir: config.manifestDir } : {}),
  };
}

/** The session `serve` and `query` use: the simulated CP750 with `mock`, otherwise the real one. */
export async function createSession(config: ServerConfig): Promise<SessionHandle> {
  if (config.mock) return createMockSession(config);

  const session = createCp750Session(sessionOptions(config));
  return {
    session,
    description: `CP750 at ${config.cp750Host}:${config.cp750Port}`,
    close: () => session.close(),
  };
}

/** The newest firmware manifest (built-ins plus `CP750_MANIFEST_DIR`). */
async function newestManifest(config: ServerConfig): Promise<Manifest> {
  const manifests = await loadManifests({ dir: config.manifestDir });
  const newest = manifests.at(-1);
  if (!newest) throw new Error("No firmware manifests available");
  return newest;
}

async function createMockSession(config: ServerConfig): Promise<SessionHandle> {
  const manifest = await newestManifest(config);

  const mock = await startMockCp750({
    manifest,
    host: "127.0.0.1",
    port: 0,
    // Start where a booth usually sits rather than at the schema minimums (fader 0 = -90 dB).
    initial: { "cp750.sys.fader": 70, "cp750.sys.input_mode": "dig_1" },
  });
  const session = createCp750Session({
    ...sessionOptions(config),
    host: mock.host,
    port: mock.port,
  });
  return {
    session,
    description: `mock CP750 (firmware ${manifest.firmware}) at ${mock.host}:${mock.port}`,
    close: async () => {
      await session.close();
      await mock.close();
    },
  };
}

export interface CaptureOptions {
  host: string;
  port?: number;
  eol?: string;
  timeoutMs?: number;
}

export interface CaptureResult {
  firmware: string;
  help: string[];
  status: string[];
  draftManifest: Manifest;
}

/** Connects to a unit and records `version`, `help` and `status` plus a draft manifest. */
export async function captureDevice(options: CaptureOptions): Promise<CaptureResult> {
  return captureFromDevice(options);
}
