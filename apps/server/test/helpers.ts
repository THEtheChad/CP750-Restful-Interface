import type { Cp750Session } from "@cp750/device";
import { FakeSession, type FakeSessionOptions } from "@cp750/device/testing";
import { builtinManifests, type Manifest } from "@cp750/manifests";
import { type CreateAppOptions, createApp } from "../src/app.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";

function builtin(firmware: string): Manifest {
  const found = builtinManifests().find((m) => m.firmware === firmware);
  if (!found) throw new Error(`no built-in manifest for ${firmware}`);
  return found;
}

/**
 * The 1.0.0.150183 manifest, marked verified for these tests (whatever its checked-in status), so
 * writes are allowed without a help cross-check.
 */
export const verified: Manifest = { ...builtin("1.0.0.150183"), status: "verified" };
/** A draft manifest: 1.2.8.3, forced to draft. */
export const draft: Manifest = { ...builtin("1.2.8.3"), status: "draft" };

export interface Setup {
  session: FakeSession;
  app: ReturnType<typeof createApp>;
  config: ServerConfig;
  logs: string[];
}

export async function setup(
  options: {
    fake?: FakeSessionOptions;
    env?: Record<string, string>;
    app?: Partial<CreateAppOptions>;
    session?: Cp750Session;
    connect?: boolean;
  } = {},
): Promise<Setup> {
  const session = new FakeSession({ manifest: verified, ...options.fake });
  if (options.connect !== false) await session.connect();
  const config = loadConfig(options.env ?? {});
  const logs: string[] = [];
  const app = createApp({
    session: options.session ?? session,
    config,
    log: (line) => logs.push(line),
    ...options.app,
  });
  return { session, app, config, logs };
}

export function put(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** A JSON POST; without `body` it sends `Content-Type: application/json` and an empty body. */
export function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for loosely typed JSON bodies
export async function json(res: Response): Promise<any> {
  return res.json();
}
