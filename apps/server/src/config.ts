/**
 * Server configuration from the environment and CLI flags (flags win). See docs/ARCHITECTURE.md,
 * "HTTP API" (config table). `CP750_API_TOKEN` has no flag on purpose: argv is visible to every
 * user on the machine (`ps`), so the token only comes from the environment.
 */
import { parseArgs } from "node:util";
import { DEFAULT_EOL, DEFAULT_HOST, DEFAULT_PORT } from "@cp750/device";
import { z } from "zod";

export type LineEnding = "\r\n" | "\n" | "\r";

export interface ServerConfig {
  /** `CP750_HOST`: the processor's address. */
  cp750Host: string;
  /** `CP750_PORT`: the processor's TCP port. */
  cp750Port: number;
  /** `LISTEN_HOST`: the address the HTTP server binds to. Localhost by default. */
  listenHost: string;
  /** `PORT`: the HTTP port (0 picks a free one). */
  port: number;
  /** `CP750_READ_ONLY`: refuse every write and action. */
  readOnly: boolean;
  /** `CP750_ALLOW_FULL`: allow `full`-tier params. */
  allowFull: boolean;
  /** `CP750_ALLOW_INTERNAL`: allow `internal` params. */
  allowInternal: boolean;
  /** `CP750_API_TOKEN`: when set, every mutating request needs `Authorization: Bearer <token>`. */
  apiToken: string | undefined;
  /** `CP750_EOL`: command terminator. */
  eol: LineEnding;
  /** `CP750_POLL_MS`: poll interval for change events; unset or 0 disables polling. */
  pollMs: number | undefined;
  /** `CP750_MANIFEST_DIR`: extra firmware manifests. */
  manifestDir: string | undefined;
  /** `CP750_MOCK`: talk to a simulated CP750 instead of a real one. */
  mock: boolean;
  /** `CORS_ORIGIN`: comma-separated origins allowed cross-origin access. Off when unset. */
  corsOrigins: readonly string[];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

interface Setting {
  key: keyof ServerConfig;
  env: string;
  /** CLI flag (without `--`); `null` for env-only settings. */
  flag: string | null;
  type: "string" | "boolean";
  description: string;
  defaultLabel: string;
}

/** Every setting, in the order shown by `--help`. */
export const SETTINGS: readonly Setting[] = [
  {
    key: "cp750Host",
    env: "CP750_HOST",
    flag: "cp750-host",
    type: "string",
    description: "CP750 address",
    defaultLabel: DEFAULT_HOST,
  },
  {
    key: "cp750Port",
    env: "CP750_PORT",
    flag: "cp750-port",
    type: "string",
    description: "CP750 TCP port",
    defaultLabel: String(DEFAULT_PORT),
  },
  {
    key: "listenHost",
    env: "LISTEN_HOST",
    flag: "listen-host",
    type: "string",
    description: "HTTP bind address",
    defaultLabel: "127.0.0.1",
  },
  {
    key: "port",
    env: "PORT",
    flag: "port",
    type: "string",
    description: "HTTP port",
    defaultLabel: "2222",
  },
  {
    key: "readOnly",
    env: "CP750_READ_ONLY",
    flag: "read-only",
    type: "boolean",
    description: "refuse all writes and actions",
    defaultLabel: "off",
  },
  {
    key: "allowFull",
    env: "CP750_ALLOW_FULL",
    flag: "allow-full",
    type: "boolean",
    description: "allow full-tier params",
    defaultLabel: "off",
  },
  {
    key: "allowInternal",
    env: "CP750_ALLOW_INTERNAL",
    flag: "allow-internal",
    type: "boolean",
    description: "allow internal params",
    defaultLabel: "off",
  },
  {
    key: "apiToken",
    env: "CP750_API_TOKEN",
    flag: null,
    type: "string",
    description: "Bearer token required for mutations (env only)",
    defaultLabel: "unset",
  },
  {
    key: "eol",
    env: "CP750_EOL",
    flag: "eol",
    type: "string",
    description: "command terminator: crlf | lf | cr",
    defaultLabel: "crlf",
  },
  {
    key: "pollMs",
    env: "CP750_POLL_MS",
    flag: "poll-ms",
    type: "string",
    description: "poll interval in ms (0 = off)",
    defaultLabel: "off",
  },
  {
    key: "manifestDir",
    env: "CP750_MANIFEST_DIR",
    flag: "manifest-dir",
    type: "string",
    description: "directory of extra firmware manifests",
    defaultLabel: "none",
  },
  {
    key: "mock",
    env: "CP750_MOCK",
    flag: "mock",
    type: "boolean",
    description: "use a simulated CP750",
    defaultLabel: "off",
  },
  {
    key: "corsOrigins",
    env: "CORS_ORIGIN",
    flag: "cors-origin",
    type: "string",
    description: "comma-separated origins allowed cross-origin",
    defaultLabel: "none",
  },
];

/** `node:util` `parseArgs` options for every config flag. `--host` is short for `--cp750-host`. */
export const CONFIG_FLAG_OPTIONS = {
  ...Object.fromEntries(
    SETTINGS.filter((s) => s.flag).map((s) => [s.flag as string, { type: s.type }]),
  ),
  host: { type: "string" },
} as Record<string, { type: "string" | "boolean" }>;

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off", ""]);
const EOLS: Record<string, LineEnding> = {
  crlf: "\r\n",
  "\\r\\n": "\r\n",
  "\r\n": "\r\n",
  lf: "\n",
  "\\n": "\n",
  "\n": "\n",
  cr: "\r",
  "\\r": "\r",
  "\r": "\r",
};

const flag = z.union([z.string(), z.boolean()]).optional();

const bool = flag.transform((value, ctx) => {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  const text = value.trim().toLowerCase();
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  ctx.addIssue({ code: "custom", message: `expected 1/0, true/false, yes/no or on/off` });
  return z.NEVER;
});

function integer<F extends number | undefined>(min: number, max: number, fallback: F) {
  return flag.transform((value, ctx) => {
    if (value === undefined || value === "") return fallback;
    if (typeof value === "boolean" || !/^\s*\d+\s*$/.test(value)) {
      ctx.addIssue({ code: "custom", message: `expected an integer from ${min} to ${max}` });
      return z.NEVER;
    }
    const n = Number(value);
    if (n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `expected an integer from ${min} to ${max}` });
      return z.NEVER;
    }
    return n;
  });
}

function text<F extends string | undefined>(fallback: F) {
  return flag.transform((value, ctx) => {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") {
      ctx.addIssue({ code: "custom", message: "expected a value" });
      return z.NEVER;
    }
    const trimmed = value.trim();
    return trimmed === "" ? fallback : trimmed;
  });
}

const HOSTNAME = /^[A-Za-z0-9.\-:[\]%]+$/;

function host(fallback: string) {
  return text(fallback).transform((value, ctx) => {
    if (!HOSTNAME.test(value)) {
      ctx.addIssue({ code: "custom", message: "expected a hostname or IP address" });
      return z.NEVER;
    }
    return value;
  });
}

const schema = z.object({
  cp750Host: host(DEFAULT_HOST),
  cp750Port: integer(1, 65535, DEFAULT_PORT),
  listenHost: host("127.0.0.1"),
  port: integer(0, 65535, 2222),
  readOnly: bool,
  allowFull: bool,
  allowInternal: bool,
  apiToken: flag.transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (typeof value === "boolean" || /\s/.test(value)) {
      ctx.addIssue({ code: "custom", message: "expected a token without whitespace" });
      return z.NEVER;
    }
    return value;
  }),
  eol: flag.transform((value, ctx) => {
    if (value === undefined || value === "") return DEFAULT_EOL as LineEnding;
    const eol = typeof value === "string" ? EOLS[value.toLowerCase()] : undefined;
    if (!eol) {
      ctx.addIssue({ code: "custom", message: "expected crlf, lf or cr" });
      return z.NEVER;
    }
    return eol;
  }),
  pollMs: integer(0, 86_400_000, undefined),
  manifestDir: text(undefined),
  mock: bool,
  corsOrigins: text(undefined).transform((value, ctx) => {
    if (!value) return [];
    const origins = value
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    for (const origin of origins) {
      if (origin === "*") continue;
      let parsed: URL | undefined;
      try {
        parsed = new URL(origin);
      } catch {}
      if (!parsed || !/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) {
        ctx.addIssue({
          code: "custom",
          message: `"${origin}" is not an origin like https://example.com:8080 (or *)`,
        });
        return z.NEVER;
      }
    }
    return origins;
  }),
});

/** Parses the config flags in `argv`. Unknown flags and positionals are ignored (the CLI checks those). */
function parseFlags(argv: readonly string[]): Record<string, string | boolean | undefined> {
  const { values } = parseArgs({
    args: [...argv],
    options: CONFIG_FLAG_OPTIONS,
    strict: false,
    allowPositionals: true,
  });
  return values as Record<string, string | boolean | undefined>;
}

/**
 * Builds the server config from `env` (e.g. `process.env`) and CLI `argv` (flags override env).
 * Throws `ConfigError` listing every invalid setting.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[] = [],
): ServerConfig {
  const flags = parseFlags(argv);
  const raw: Record<string, string | boolean | undefined> = {};
  for (const setting of SETTINGS) {
    const fromFlag = setting.flag ? flags[setting.flag] : undefined;
    raw[setting.key] = fromFlag ?? env[setting.env];
  }
  if (flags.host !== undefined && flags["cp750-host"] === undefined) raw.cp750Host = flags.host;

  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const setting = SETTINGS.find((s) => s.key === issue.path[0]);
    if (!setting) return issue.message;
    const source = setting.flag ? `${setting.env} / --${setting.flag}` : setting.env;
    const shown = setting.key === "apiToken" ? "" : ` (got ${JSON.stringify(raw[setting.key])})`;
    return `${source}: ${issue.message}${shown}`;
  });
  throw new ConfigError(issues);
}

/** True when `host` only accepts connections from this machine. */
export function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
}
