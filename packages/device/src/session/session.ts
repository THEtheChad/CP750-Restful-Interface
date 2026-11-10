/**
 * The real `Cp750Session` over TCP (docs/ARCHITECTURE.md, "Session"). Every access decision goes
 * through `policy.ts`; every exchange with the unit goes through one `Cp750Client` queue, so API
 * calls, polls and detection never interleave.
 */
import {
  decode,
  encode,
  loadManifests,
  type Manifest,
  type ManifestSelection,
  type ParamSpec,
  type ParamValue,
  selectManifest,
  ValueCodecError,
  valuesEqual,
} from "@cp750/manifests";
import {
  type CommandInfo,
  type ConnectionStatus,
  type Cp750Session,
  DEFAULT_POLL_PARAMS,
  DEFAULT_PORT,
  type ManifestInfo,
  type MutationOptions,
  type ParamOperation,
  type ParamResult,
  type SessionErrorInfo,
  type SessionEvent,
  type SessionEventOf,
  type SessionEventType,
  type SessionLogger,
  type SessionOptions,
  type SessionState,
  type Unsubscribe,
} from "../contracts.ts";
import {
  Forbidden,
  InvalidValue,
  isCp750Error,
  NotConnected,
  UnknownParameter,
  WriteRejected,
} from "../errors.ts";
import {
  type AccessPolicy,
  assertOperation,
  assertValue,
  checkOperation,
  describeCommands,
  isRawReadLine,
  type ResolvedName,
  resolveName,
} from "../policy.ts";
import { Cp750Client } from "../protocol/client.ts";
import { extractFirmware, extractParamNames } from "../protocol/help.ts";

export const FULL_CONTROL_PARAM = "cp750.ctrl.full_ascii_ctrl";
export const VERSION_PARAM = "cp750.sysinfo.version";

export const RECONNECT_DEFAULTS = { initialDelayMs: 500, maxDelayMs: 30_000 } as const;

/** Creates a session. Nothing happens on the network until `connect()`. */
export function createCp750Session(options: SessionOptions): Cp750Session {
  return new TcpSession(options);
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

class TcpSession implements Cp750Session {
  private readonly options: SessionOptions;
  private readonly port: number;
  private readonly logger: SessionLogger;
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private readonly values = new Map<string, ParamValue>();
  private readonly pollSkips = new Set<string>();
  private connection: ConnectionStatus = "idle";
  private lastError: SessionErrorInfo | null = null;
  /** The detected, ready client. */
  private client: Cp750Client | null = null;
  /** A client still connecting or running detection. */
  private pendingClient: Cp750Client | null = null;
  private firmware: string | null = null;
  private selection: ManifestSelection | null = null;
  private helpNames: ReadonlySet<string> | null = null;
  private helpCoversFull = true;
  private fullControl = false;
  private enablingFull: Promise<void> | null = null;
  private manifests: readonly Manifest[] | null = null;
  private loop: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private readonly waiters: Waiter[] = [];
  private wake: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SessionOptions) {
    this.options = options;
    this.port = options.port ?? DEFAULT_PORT;
    this.logger = options.logger ?? console;
  }

  get state(): SessionState {
    return {
      connection: this.connection,
      host: this.options.host,
      port: this.port,
      firmware: this.firmware,
      manifest: this.manifestInfo(),
      fullControl: this.fullControl,
      readOnly: this.options.readOnly ?? false,
      allowFull: this.options.allowFull ?? false,
      allowInternal: this.options.allowInternal ?? false,
      lastError: this.lastError,
    };
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new NotConnected("Session is closed"));
    if (this.client && !this.client.closed) return Promise.resolve();
    const ready = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    this.loop ??= this.run();
    return ready;
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  commands(): CommandInfo[] {
    return this.selection ? describeCommands(this.policy()) : [];
  }

  async read(name: string): Promise<ParamResult> {
    const client = this.requireClient();
    const target = assertOperation(this.policy(), name, "read");
    return this.readTarget(client, target, name);
  }

  write(name: string, value: unknown, options: MutationOptions = {}): Promise<ParamResult> {
    return this.mutate(name, value, "write", options);
  }

  action(name: string, value?: unknown, options: MutationOptions = {}): Promise<ParamResult> {
    return this.mutate(name, value, "action", options);
  }

  async sendRaw(line: string): Promise<string[]> {
    if (!isRawReadLine(line)) {
      throw new Forbidden(line.trim(), "raw-command", "Only read-only lines may be sent raw");
    }
    const client = this.requireClient();
    const text = line.trim().toLowerCase();
    const query = /^(\S+?)\s*\?$/.exec(text);
    if (!query?.[1]) return client.multi(text);
    const name = query[1];
    if (name.startsWith("cp750.internal.") && !this.options.allowInternal) {
      throw new Forbidden(name, "internal", `read ${name}: internal`);
    }
    try {
      return [(await client.query(name)).line];
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

  // ---- connection loop ----

  private async run(): Promise<void> {
    try {
      this.manifests ??=
        this.options.manifests ?? (await loadManifests({ dir: this.options.manifestDir }));
    } catch (error) {
      // A bad manifest directory is a configuration error: fail fast instead of retrying.
      this.lastError = { code: "CONNECTION", message: errorMessage(error) };
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter.reject(asError(error));
      this.setConnection("closed");
      return;
    }

    const initialDelay =
      this.options.reconnect?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs;
    const maxDelay = this.options.reconnect?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs;
    let delay = initialDelay;
    let everConnected = false;

    while (!this.closed) {
      if (this.connection !== "reconnecting") {
        this.setConnection(everConnected ? "reconnecting" : "connecting");
      }
      let client: Cp750Client | null = null;
      try {
        client = await this.openClient();
        if (this.closed) {
          await client.close();
          break;
        }
        this.pendingClient = client;
        await this.detect(client);
        if (this.closed) break;
        if (client.closed) throw new NotConnected("Connection lost during detection");
        this.pendingClient = null;
        this.client = client;
        everConnected = true;
        delay = initialDelay;
        this.emit({
          type: "device",
          firmware: this.firmware,
          manifest: this.manifestInfo(),
          at: now(),
        });
        this.setConnection("connected");
        for (const waiter of this.waiters.splice(0)) waiter.resolve();
        this.startPolling(client);

        const error = await client.done;
        this.stopPolling();
        if (this.client === client) this.client = null;
        this.fullControl = false;
        if (this.closed) break;
        this.lastError = {
          code: "CONNECTION",
          message: error ? `Connection lost: ${error.message}` : "Connection closed by the unit",
        };
        this.setConnection("reconnecting");
      } catch (error) {
        if (this.pendingClient === client) this.pendingClient = null;
        client?.destroy();
        this.fullControl = false;
        if (this.closed) break;
        this.lastError = toErrorInfo(error);
        this.setConnection("reconnecting");
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  private openClient(): Promise<Cp750Client> {
    const t = this.options.timeouts ?? {};
    return Cp750Client.connect({
      host: this.options.host,
      port: this.port,
      ...(this.options.eol !== undefined && { eol: this.options.eol }),
      ...(t.connectMs !== undefined && { connectTimeoutMs: t.connectMs }),
      ...(t.commandMs !== undefined && { commandTimeoutMs: t.commandMs }),
      ...(t.idleMs !== undefined && { idleMs: t.idleMs }),
      ...(t.blankGraceMs !== undefined && { blankGraceMs: t.blankGraceMs }),
      ...(t.multiLineMaxMs !== undefined && { multiLineMaxMs: t.multiLineMaxMs }),
      onUnsolicited: (line) => this.logger.debug?.(`CP750 unsolicited: ${line.trim()}`),
    });
  }

  /** Version → manifest selection → full control (if allowed) → `help` cross-check. */
  private async detect(client: Cp750Client): Promise<void> {
    let firmware: string | null = null;
    try {
      const reply = await client.query(VERSION_PARAM);
      firmware = extractFirmware(reply.value) ?? (reply.value || null);
    } catch (error) {
      if (!(error instanceof UnknownParameter)) throw error;
      this.logger.warn("The CP750 did not report a firmware version; no manifest will be used");
    }
    this.firmware = firmware;
    this.selection = firmware
      ? selectManifest(firmware, this.manifests ?? [])
      : { manifest: null, match: "none", verified: false };
    this.fullControl = false;
    this.pollSkips.clear();

    // Enable the full set before `help`, so `help` can vouch for full-tier params too.
    if (this.options.allowFull && this.selection.manifest) {
      await this.enableFullControl(client).catch((error) => {
        if (error instanceof NotConnected) throw error;
        this.logger.warn(`Could not enable full control: ${errorMessage(error)}`);
      });
    }

    let helpNames: Set<string> | null = null;
    try {
      const names = extractParamNames(await client.multi("help"));
      helpNames = names.length > 0 ? new Set(names) : null;
    } catch (error) {
      if (error instanceof NotConnected) throw error;
      this.logger.warn(`help cross-check skipped: ${errorMessage(error)}`);
    }
    this.helpNames = helpNames;
    this.helpCoversFull = this.fullControl;
  }

  private async shutdown(): Promise<void> {
    this.closed = true;
    this.stopPolling();
    this.wake?.();
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new NotConnected("Session is closed"));
    }
    const clients = [this.client, this.pendingClient].filter((c): c is Cp750Client => c !== null);
    this.client = null;
    this.pendingClient = null;
    await Promise.all(clients.map((c) => c.close()));
    this.fullControl = false;
    if (this.connection !== "closed") this.setConnection("closed");
  }

  private sleep(ms: number): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  // ---- operations ----

  private async readTarget(
    client: Cp750Client,
    target: ResolvedName,
    input: string,
  ): Promise<ParamResult> {
    await this.ensureTier(client, target);
    const reply = await withCallerName(input, client.query(target.name));
    const value = this.decodeValue(target, reply.value);
    this.record(target, value, reply.value);
    return { name: target.name, value, raw: reply.value };
  }

  private async mutate(
    name: string,
    value: unknown,
    op: Exclude<ParamOperation, "read">,
    options: MutationOptions,
  ): Promise<ParamResult> {
    const client = this.requireClient();
    const target = assertOperation(this.policy(), name, op, options);
    const requested = assertValue(target, value, op) as ParamValue;
    // assertValue throws for targets without a spec.
    const spec = target.spec as ParamSpec;
    let wire: string;
    try {
      wire = encode(spec, requested);
    } catch (error) {
      if (error instanceof ValueCodecError) {
        throw new InvalidValue(target.name, requested, [error.message]);
      }
      throw error;
    }
    await this.ensureTier(client, target);
    const reply = await withCallerName(name, client.set(target.name, wire));
    const actual = this.decodeValue(target, reply.value);

    if (op === "action") {
      if (target.name === FULL_CONTROL_PARAM) this.fullControl = actual === 1;
      return { name: target.name, value: actual, raw: reply.value };
    }
    this.record(target, actual, reply.value);
    if (!valuesEqual(spec, actual, requested)) {
      throw new WriteRejected(target.name, requested, actual, reply.value);
    }
    return { name: target.name, value: actual, raw: reply.value };
  }

  /** With `allowFull`, makes sure `full_ascii_ctrl` is 1 before a full-tier param is used. */
  private async ensureTier(client: Cp750Client, target: ResolvedName): Promise<void> {
    if (target.spec?.tier !== "full" || !this.options.allowFull || this.fullControl) return;
    try {
      await this.enableFullControl(client);
    } catch (error) {
      // Let the param's own request report what the unit does (a blank reply → UnknownParameter).
      if (!(error instanceof UnknownParameter)) throw error;
    }
  }

  private enableFullControl(client: Cp750Client): Promise<void> {
    this.enablingFull ??= (async () => {
      try {
        const reply = await client.set(FULL_CONTROL_PARAM, "1");
        this.fullControl = reply.value.trim() === "1";
        if (!this.fullControl) {
          this.logger.warn(`The CP750 refused full control (replied "${reply.line}")`);
        }
      } finally {
        this.enablingFull = null;
      }
    })();
    return this.enablingFull;
  }

  private decodeValue(target: ResolvedName, raw: string): ParamValue {
    if (!target.spec) return raw;
    try {
      return decode(target.spec, raw);
    } catch {
      this.logger.debug?.(`${target.name}: undecodable value "${raw}", kept as text`);
      return raw;
    }
  }

  /** Remembers the value and emits a `param` event if it changed (or is new). */
  private record(target: ResolvedName, value: ParamValue, raw: string): void {
    const previous = this.values.get(target.name);
    this.values.set(target.name, value);
    if (previous !== undefined) {
      const same = target.spec
        ? typeof previous === typeof value && valuesEqual(target.spec, previous, value)
        : previous === value;
      if (same) return;
    }
    this.emit({ type: "param", name: target.name, value, raw, previous, at: now() });
  }

  // ---- polling ----

  private startPolling(client: Cp750Client): void {
    const interval = this.options.pollIntervalMs ?? 0;
    if (interval <= 0) return;
    const tick = async () => {
      this.pollTimer = null;
      await this.pollOnce(client);
      if (this.client === client && !this.closed) this.pollTimer = setTimeout(tick, interval);
    };
    this.pollTimer = setTimeout(tick, 0);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollOnce(client: Cp750Client): Promise<void> {
    const policy = this.policy();
    for (const input of this.options.pollParams ?? DEFAULT_POLL_PARAMS) {
      if (client.closed || this.closed) return;
      const target = resolveName(policy, input);
      const reason = target ? checkOperation(policy, target, "read") : "unknown";
      if (!target || reason) {
        this.skipPoll(input, reason ?? "unknown");
        continue;
      }
      try {
        await this.readTarget(client, target, input);
      } catch (error) {
        if (error instanceof NotConnected) return;
        this.logger.debug?.(`poll ${target.name} failed: ${errorMessage(error)}`);
      }
    }
  }

  private skipPoll(name: string, reason: string): void {
    const key = `${name}\u0000${reason}`;
    if (this.pollSkips.has(key)) return;
    this.pollSkips.add(key);
    this.logger.warn(`Not polling ${name}: ${reason}`);
  }

  // ---- helpers ----

  private requireClient(): Cp750Client {
    const client = this.client;
    if (!client || client.closed || this.connection !== "connected") throw new NotConnected();
    return client;
  }

  private policy(): AccessPolicy {
    return {
      manifest: this.selection?.manifest ?? null,
      verified: this.selection?.verified ?? false,
      helpNames: this.helpNames,
      helpCoversFull: this.helpCoversFull,
      allowFull: this.options.allowFull ?? false,
      allowInternal: this.options.allowInternal ?? false,
      readOnly: this.options.readOnly ?? false,
    };
  }

  private manifestInfo(): ManifestInfo | null {
    const selection = this.selection;
    if (!selection) return null;
    const manifest = selection.manifest;
    if (!manifest || selection.match === "none") {
      return { firmware: null, status: null, match: "none", verified: false };
    }
    return {
      firmware: manifest.firmware,
      status: manifest.status,
      match: selection.match,
      verified: selection.verified,
    };
  }

  private setConnection(connection: ConnectionStatus): void {
    this.connection = connection;
    if (connection === "connected") this.lastError = null;
    this.emit({ type: "connection", connection, error: this.lastError, at: now() });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(`session event listener threw: ${errorMessage(error)}`);
      }
    }
  }
}

/** Re-labels a blank-reply `UnknownParameter` with the name the caller used. */
async function withCallerName<T>(input: string, request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof UnknownParameter) {
      throw new UnknownParameter(input, "got a blank reply from the CP750");
    }
    throw error;
  }
}

function toErrorInfo(error: unknown): SessionErrorInfo {
  if (isCp750Error(error) && error.code !== "NOT_CONNECTED") {
    return { code: error.code, message: error.message };
  }
  return { code: "CONNECTION", message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function now(): string {
  return new Date().toISOString();
}
