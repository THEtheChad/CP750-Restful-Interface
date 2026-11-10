/**
 * The only place the server constructs sessions. Everything else codes against the
 * `Cp750Session` contract, so wiring in the real TCP client, the mock CP750 and `captureDevice`
 * from `@cp750/device` only touches the `// INTEGRATION:` points below. Their final signatures:
 *
 *   createCp750Session(options: SessionOptions): Cp750Session                       ("@cp750/device")
 *   startMockCp750(options: { manifest: Manifest; port?: number; host?: string })
 *     : Promise<{ port: number; host: string; close(): Promise<void> }>              ("@cp750/device/mock")
 *   captureDevice(options: { host: string; port?: number; eol?: string; timeoutMs?: number })
 *     : Promise<{ firmware: string; help: string[]; status: string[]; draftManifest: Manifest }>
 *                                                                                    ("@cp750/device")
 */
import { type Cp750Session, FakeSession, type SessionOptions } from "@cp750/device";
import { loadManifests, type Manifest } from "@cp750/manifests";
import type { ServerConfig } from "./config.ts";

export class NotWiredError extends Error {
  constructor(feature: string) {
    super(
      `${feature} is not wired up yet: this build has no real CP750 client. Use --mock (CP750_MOCK=1) for now.`,
    );
    this.name = "NotWiredError";
  }
}

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

  // INTEGRATION: real session. Replace the throw with:
  //   const session = createCp750Session(sessionOptions(config));
  //   return {
  //     session,
  //     description: `CP750 at ${config.cp750Host}:${config.cp750Port}`,
  //     close: () => session.close(),
  //   };
  throw new NotWiredError("The real CP750 session");
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

  // INTEGRATION: mock mode. Replace the FakeSession below with the TCP mock + real client:
  //   const mock = await startMockCp750({ manifest, host: "127.0.0.1" });
  //   const session = createCp750Session({ ...sessionOptions(config), host: mock.host, port: mock.port });
  //   return {
  //     session,
  //     description: `mock CP750 ${manifest.firmware} at ${mock.host}:${mock.port}`,
  //     close: async () => {
  //       await session.close();
  //       await mock.close();
  //     },
  //   };
  const session = new FakeSession({
    manifest,
    // A fake `help` listing every param, so a draft manifest still allows writes.
    helpNames: Object.keys(manifest.params),
    allowFull: config.allowFull,
    allowInternal: config.allowInternal,
    readOnly: config.readOnly,
    values: { "cp750.sysinfo.version": manifest.firmware },
    host: "mock",
    port: 0,
  });
  return {
    session,
    description: `simulated CP750 (firmware ${manifest.firmware}, in-memory)`,
    close: () => session.close(),
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
export async function captureDevice(_options: CaptureOptions): Promise<CaptureResult> {
  // INTEGRATION: capture. Replace the throw with:
  //   return captureDevice(_options);   // imported from "@cp750/device" (rename this wrapper's import)
  throw new NotWiredError("capture");
}
