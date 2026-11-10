/**
 * The contract between the session (implemented in this package) and its consumers (the HTTP
 * API in apps/server). See docs/ARCHITECTURE.md, "Session".
 */
import type {
  Manifest,
  ManifestMatch,
  ManifestStatus,
  ParamSpec,
  ParamValue,
} from "@cp750/manifests";
import type { Cp750ErrorCode, ForbiddenReason } from "./errors.ts";

export {
  Cp750Error,
  type Cp750ErrorCode,
  Forbidden,
  type ForbiddenReason,
  InvalidValue,
  isCp750Error,
  NotConnected,
  Timeout,
  UnknownParameter,
  WriteRejected,
} from "./errors.ts";

export const DEFAULT_HOST = "192.168.1.136";
export const DEFAULT_PORT = 61408;
export const DEFAULT_EOL = "\r\n";
export const DEFAULT_POLL_PARAMS: readonly string[] = [
  "cp750.sys.fader",
  "cp750.sys.mute",
  "cp750.sys.input_mode",
];

export interface SessionTimeouts {
  /** TCP connect timeout. */
  connectMs?: number;
  /** How long to wait for the reply to one command. */
  commandMs?: number;
  /** For multi-line replies (`help`, `status`): the reply ends after this much silence. */
  idleMs?: number;
}

export interface ReconnectOptions {
  /** First retry delay; doubles on each failure. */
  initialDelayMs?: number;
  /** Backoff cap. */
  maxDelayMs?: number;
}

export interface SessionOptions {
  host: string;
  /** Default `DEFAULT_PORT` (61408). */
  port?: number;
  /** Line terminator for commands. Default `DEFAULT_EOL` (`\r\n`). */
  eol?: string;
  timeouts?: SessionTimeouts;
  reconnect?: ReconnectOptions;
  /** Poll `pollParams` at this interval and emit `param` events on change. Off when unset or 0. */
  pollIntervalMs?: number;
  /** Default `DEFAULT_POLL_PARAMS`. Names or aliases. */
  pollParams?: readonly string[];
  /** Allow `full`-tier params (`CP750_ALLOW_FULL`). The session sets `cp750.ctrl.full_ascii_ctrl 1`. */
  allowFull?: boolean;
  /** Allow `internal` params (`CP750_ALLOW_INTERNAL`). */
  allowInternal?: boolean;
  /** Refuse every write and action (`CP750_READ_ONLY`). */
  readOnly?: boolean;
  /** Extra manifests directory (`CP750_MANIFEST_DIR`). */
  manifestDir?: string;
  /** Use these manifests instead of loading built-ins + `manifestDir` (tests). */
  manifests?: readonly Manifest[];
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

/** The selected manifest, as reported by `GET /api/device`. */
export type ManifestInfo =
  | {
      firmware: string;
      status: ManifestStatus;
      match: Exclude<ManifestMatch, "none">;
      verified: boolean;
    }
  | { firmware: null; status: null; match: "none"; verified: false };

export interface SessionErrorInfo {
  code: Cp750ErrorCode | "CONNECTION";
  message: string;
}

export interface SessionState {
  connection: ConnectionStatus;
  host: string;
  port: number;
  /** Firmware the unit reported (`cp750.sysinfo.version`), or `null` before detection. */
  firmware: string | null;
  /** The manifest chosen for `firmware`, or `null` before detection. */
  manifest: ManifestInfo | null;
  /** True while the session believes `cp750.ctrl.full_ascii_ctrl` is 1. */
  fullControl: boolean;
  readOnly: boolean;
  allowFull: boolean;
  allowInternal: boolean;
  /** The most recent connection or detection error, cleared on a successful connect. */
  lastError: SessionErrorInfo | null;
}

export type ParamOperation = "read" | "write" | "action";

/**
 * Result of the `help` cross-check for one name:
 * - `confirmed`: listed by `help`
 * - `missing`: in the manifest but not listed by `help` (the param is unavailable)
 * - `unchecked`: `help` gave no names, so there was nothing to check against
 */
export type Availability = "confirmed" | "missing" | "unchecked";

export interface CommandInfo {
  /** Canonical lowercase name. */
  name: string;
  /** `manifest` params carry a spec; `help` names missing from the manifest are raw read-only. */
  source: "manifest" | "help";
  spec: ParamSpec | null;
  availability: Availability;
  /** Operations allowed right now. Destructive params still need `confirm: true`. */
  operations: readonly ParamOperation[];
  /** Why each operation not in `operations` is refused. */
  blocked: Partial<Record<ParamOperation, ForbiddenReasonOrUnknown>>;
}

/** `unavailable` means the op would raise `UnknownParameter` (help says the unit lacks it). */
export type ForbiddenReasonOrUnknown = ForbiddenReason | "unavailable";

export interface ParamResult {
  /** Canonical name. */
  name: string;
  /** Decoded value (raw trimmed string for params without a spec). */
  value: ParamValue;
  /** The value part of the unit's reply, NULs stripped. */
  raw: string;
}

export interface MutationOptions {
  /** Required for `destructive` params. */
  confirm?: boolean;
}

export type SessionEvent =
  | {
      type: "param";
      name: string;
      value: ParamValue;
      raw: string;
      /** `undefined` the first time the session sees the param. */
      previous: ParamValue | undefined;
      /** ISO timestamp. */
      at: string;
    }
  | { type: "connection"; connection: ConnectionStatus; error: SessionErrorInfo | null; at: string }
  | { type: "device"; firmware: string | null; manifest: ManifestInfo | null; at: string };

export type SessionEventType = SessionEvent["type"];
export type SessionEventOf<T extends SessionEventType> = Extract<SessionEvent, { type: T }>;
export type Unsubscribe = () => void;

/**
 * One logical connection to a CP750. Requests are serialized (one in flight). All methods that
 * talk to the unit reject with `NotConnected` while disconnected and `Timeout` when it does not
 * answer. Names accept aliases, case-insensitively.
 */
export interface Cp750Session {
  /**
   * Starts the connection loop (idempotent) and resolves once the session is connected and
   * firmware detection, manifest selection and the `help` cross-check have run. Failed attempts
   * are retried with capped exponential backoff and reported as `connection` events; the promise
   * rejects only if `close()` is called first. Callers that should not wait can ignore it.
   */
  connect(): Promise<void>;

  /** Stops reconnecting, sends `exit` if connected, and closes the socket. Idempotent. */
  close(): Promise<void>;

  /** A snapshot of the current state. */
  readonly state: SessionState;

  /**
   * The active command list: manifest params plus `help`-only names. `internal` params are omitted
   * unless `allowInternal`. Empty before the first detection.
   */
  commands(): CommandInfo[];

  /**
   * `<param> ?`. Throws `UnknownParameter` (not in manifest/help, or the unit replied with a blank
   * line) or `Forbidden` (tier/internal).
   */
  read(name: string): Promise<ParamResult>;

  /**
   * Validates, encodes, sends `<param> <value>`, decodes the echo and compares it to the request.
   * Throws `InvalidValue`, `Forbidden`, `UnknownParameter`, or `WriteRejected` (with the actual
   * value) when the unit echoes something else.
   */
  write(name: string, value: unknown, options?: MutationOptions): Promise<ParamResult>;

  /**
   * Triggers an `action` param (`cp750.ctrl.*`). `value` defaults to `1`. The reply is returned
   * but not compared. Same errors as `write` except `WriteRejected`.
   */
  action(name: string, value?: unknown, options?: MutationOptions): Promise<ParamResult>;

  /**
   * Sends one raw line and returns the reply lines (NULs stripped). For capture and debugging, so
   * only read-only lines are allowed: `<name> ?`, `help`, `status`, `dump_log`, `dump_log_100`.
   * Anything else throws `Forbidden` with reason `raw-command`.
   */
  sendRaw(line: string): Promise<string[]>;

  /** Subscribes to one event type. */
  on<T extends SessionEventType>(
    type: T,
    listener: (event: SessionEventOf<T>) => void,
  ): Unsubscribe;

  /** Subscribes to every event (for SSE). */
  subscribe(listener: (event: SessionEvent) => void): Unsubscribe;
}
