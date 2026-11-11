import {
  builtinManifests,
  decode,
  encode,
  type Manifest,
  type ParamSpec,
  type ParamValue,
  valuesEqual,
} from "@cp750/manifests";
import {
  type CommandInfo,
  type ConnectionStatus,
  type Cp750Session,
  DEFAULT_HOST,
  DEFAULT_PORT,
  type ManifestInfo,
  type MutationOptions,
  type ParamOperation,
  type ParamResult,
  type SessionErrorInfo,
  type SessionEvent,
  type SessionEventOf,
  type SessionEventType,
  type SessionState,
  type Unsubscribe,
} from "../contracts.ts";
import { Forbidden, NotConnected, UnknownParameter, WriteRejected } from "../errors.ts";
import {
  type AccessPolicy,
  assertOperation,
  assertValue,
  describeCommands,
  isRawReadLine,
  type ResolvedName,
  resolveName,
} from "../policy.ts";

export interface FakeSessionOptions {
  /** Default: the built-in 1.0.0.150183 manifest. `null` simulates `match: "none"`. */
  manifest?: Manifest | null;
  /** Firmware the fake unit reports. Default: the manifest's. A different value gives `nearest`. */
  firmware?: string;
  /** Names the fake `help` lists. Default `null` (cross-check skipped). */
  helpNames?: readonly string[] | null;
  /** Initial unit values by canonical name. Others start at a schema default (fader: 70). */
  values?: Record<string, ParamValue>;
  allowFull?: boolean;
  allowInternal?: boolean;
  readOnly?: boolean;
  host?: string;
  port?: number;
}

function defaultValue(spec: ParamSpec): ParamValue {
  const v = spec.value;
  if (spec.unit === "fader") return 70;
  if (v.enum?.[0] !== undefined) return v.enum[0];
  if (v.type === "string") return "";
  return Math.min(Math.max(0, v.minimum ?? 0), v.maximum ?? 0);
}

/**
 * An in-memory `Cp750Session` over a manifest, for testing consumers of the contract (e.g. the
 * HTTP API). It enforces the same access rules as the real session (via `policy.ts`) but does
 * not emulate the wire protocol; use the mock TCP device for that.
 */
export class FakeSession implements Cp750Session {
  /** Lines the fake would have sent to the unit, for assertions. */
  readonly sent: string[] = [];

  private readonly manifest: Manifest | null;
  private readonly firmware: string | null;
  private readonly helpNames: ReadonlySet<string> | null;
  private readonly values = new Map<string, ParamValue>();
  private readonly rejecting = new Set<string>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private connection: ConnectionStatus = "idle";
  private lastError: SessionErrorInfo | null = null;
  private fullControl = false;
  private detected = false;
  private readonly options: Required<
    Pick<FakeSessionOptions, "allowFull" | "allowInternal" | "readOnly" | "host" | "port">
  >;

  constructor(options: FakeSessionOptions = {}) {
    this.manifest =
      options.manifest === undefined ? (builtinManifests()[0] ?? null) : options.manifest;
    this.firmware = options.firmware ?? this.manifest?.firmware ?? null;
    this.helpNames =
      options.helpNames == null ? null : new Set(options.helpNames.map((n) => n.toLowerCase()));
    this.options = {
      allowFull: options.allowFull ?? false,
      allowInternal: options.allowInternal ?? false,
      readOnly: options.readOnly ?? false,
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
    };
    for (const [name, value] of Object.entries(options.values ?? {})) this.values.set(name, value);
  }

  get state(): SessionState {
    return {
      connection: this.connection,
      host: this.options.host,
      port: this.options.port,
      firmware: this.detected ? this.firmware : null,
      manifest: this.detected ? this.manifestInfo() : null,
      fullControl: this.fullControl,
      readOnly: this.options.readOnly,
      allowFull: this.options.allowFull,
      allowInternal: this.options.allowInternal,
      lastError: this.lastError,
    };
  }

  async connect(): Promise<void> {
    if (this.connection === "closed") throw new NotConnected("Session is closed");
    if (this.connection === "connected") return;
    this.setConnection("connecting");
    this.setConnection("connected");
    this.detected = true;
    if (this.options.allowFull && this.manifest) {
      this.sent.push("cp750.ctrl.full_ascii_ctrl 1");
      this.fullControl = true;
    }
    this.emit({
      type: "device",
      firmware: this.firmware,
      manifest: this.manifestInfo(),
      at: now(),
    });
  }

  async close(): Promise<void> {
    if (this.connection === "closed") return;
    this.fullControl = false;
    this.setConnection("closed");
  }

  commands(): CommandInfo[] {
    return this.detected ? describeCommands(this.policy()) : [];
  }

  async read(name: string): Promise<ParamResult> {
    this.assertConnected();
    const target = assertOperation(this.policy(), name, "read");
    this.sent.push(`${target.name} ?`);
    const value = this.currentValue(target);
    if (value === undefined) throw new UnknownParameter(name, "got a blank reply");
    return { name: target.name, value, raw: this.wire(target, value) };
  }

  async write(name: string, value: unknown, options: MutationOptions = {}): Promise<ParamResult> {
    return this.mutate(name, value, "write", options);
  }

  async action(name: string, value?: unknown, options: MutationOptions = {}): Promise<ParamResult> {
    return this.mutate(name, value, "action", options);
  }

  async sendRaw(line: string): Promise<string[]> {
    if (!isRawReadLine(line)) {
      throw new Forbidden(line.trim(), "raw-command", "Only read-only lines may be sent raw");
    }
    this.assertConnected();
    const command = line.trim().toLowerCase();
    // Same filtering as the real session: no lines for params the read policy refuses.
    if (command === "help") {
      return this.commands()
        .filter((c) => c.blocked.read !== "full-tier" && c.blocked.read !== "internal")
        .map((c) => c.name);
    }
    if (command === "status") {
      return this.commands()
        .filter((c) => c.operations.includes("read"))
        .flatMap((c) => {
          const target = resolveName(this.policy(), c.name);
          const value = target ? this.currentValue(target) : undefined;
          return target && value !== undefined ? [`${c.name} : ${this.wire(target, value)}`] : [];
        });
    }
    if (command.startsWith("dump_log")) return [];
    try {
      const result = await this.read(command.replace(/\s*\?$/, ""));
      return [`${result.name} ${result.raw}`];
    } catch (error) {
      if (error instanceof UnknownParameter) return [""];
      throw error;
    }
  }

  on<T extends SessionEventType>(
    type: T,
    listener: (event: SessionEventOf<T>) => void,
  ): Unsubscribe {
    return this.subscribe((event) => {
      if (event.type === type) listener(event as SessionEventOf<T>);
    });
  }

  subscribe(listener: (event: SessionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- test controls ----

  /** Simulates the value changing on the unit (front panel, automation). Emits a `param` event. */
  setDeviceValue(name: string, value: ParamValue): void {
    const target = resolveName(this.policy(), name);
    if (!target) throw new UnknownParameter(name);
    this.store(target, value);
  }

  /**
   * Makes the unit ignore writes and actions on `name` (echoing its current value) until turned
   * off, so they raise `WriteRejected`.
   */
  rejectWrites(name: string, enabled = true): void {
    const target = resolveName(this.policy(), name);
    if (!target) throw new UnknownParameter(name);
    if (enabled) this.rejecting.add(target.name);
    else this.rejecting.delete(target.name);
  }

  /** Simulates a dropped connection. Call `connect()` to come back. */
  disconnect(message = "Connection lost"): void {
    this.lastError = { code: "CONNECTION", message };
    this.fullControl = false;
    this.setConnection("reconnecting");
  }

  // ---- internals ----

  private async mutate(
    name: string,
    value: unknown,
    op: Exclude<ParamOperation, "read">,
    options: MutationOptions,
  ): Promise<ParamResult> {
    this.assertConnected();
    const target = assertOperation(this.policy(), name, op, options);
    const requested = assertValue(target, value, op) as ParamValue;
    const spec = target.spec as ParamSpec;
    const raw = encode(spec, requested);
    this.sent.push(`${target.name} ${raw}`);

    if (this.rejecting.has(target.name)) {
      const actual = this.currentValue(target) ?? defaultValue(spec);
      throw new WriteRejected(target.name, requested, actual, this.wire(target, actual));
    }
    if (op === "action") {
      if (target.name === "cp750.ctrl.full_ascii_ctrl") this.fullControl = requested === 1;
      return { name: target.name, value: decode(spec, raw), raw };
    }
    const echoed = decode(spec, raw);
    if (!valuesEqual(spec, echoed, requested)) {
      throw new WriteRejected(target.name, requested, echoed, raw);
    }
    this.store(target, echoed);
    return { name: target.name, value: echoed, raw };
  }

  private store(target: ResolvedName, value: ParamValue): void {
    const previous = this.values.get(target.name);
    this.values.set(target.name, value);
    if (previous === value) return;
    this.emit({
      type: "param",
      name: target.name,
      value,
      raw: this.wire(target, value),
      previous,
      at: now(),
    });
  }

  private currentValue(target: ResolvedName): ParamValue | undefined {
    const stored = this.values.get(target.name);
    if (stored !== undefined) return stored;
    if (target.spec) return defaultValue(target.spec);
    return target.availability === "confirmed" ? "" : undefined;
  }

  private wire(target: ResolvedName, value: ParamValue): string {
    if (!target.spec) return String(value);
    try {
      return encode(target.spec, value);
    } catch {
      return String(value);
    }
  }

  private manifestInfo(): ManifestInfo {
    const m = this.manifest;
    if (!m) return { firmware: null, status: null, match: "none", verified: false };
    const exact = this.firmware === m.firmware;
    return {
      firmware: m.firmware,
      status: m.status,
      match: exact ? "exact" : "nearest",
      verified: exact && m.status === "verified",
    };
  }

  private policy(): AccessPolicy {
    return {
      manifest: this.manifest,
      verified: this.manifestInfo().verified,
      helpNames: this.helpNames,
      allowFull: this.options.allowFull,
      allowInternal: this.options.allowInternal,
      readOnly: this.options.readOnly,
    };
  }

  private assertConnected(): void {
    if (this.connection !== "connected") throw new NotConnected();
  }

  private setConnection(connection: ConnectionStatus): void {
    this.connection = connection;
    if (connection === "connected") this.lastError = null;
    this.emit({ type: "connection", connection, error: this.lastError, at: now() });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function now(): string {
  return new Date().toISOString();
}
