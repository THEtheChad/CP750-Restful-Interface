/**
 * The CP750 protocol client: one persistent TCP socket, a strict FIFO queue with one request in
 * flight, per-request timeouts, and reply matching (docs/ARCHITECTURE.md, "Session").
 *
 * Reply matching for a single-line request (`<param> ?` or `<param> <value>`):
 * - lines whose key (first token, case-insensitive) is not the requested param are unrelated
 *   (the 21st-session warning, unsolicited text) and are ignored;
 * - the first line whose key is the param is the reply;
 * - a blank line before any match means "unknown parameter", but only after a short grace window
 *   (`blankGraceMs`) without a matching line. A unit that treats CR and LF as two terminators
 *   answers the LF of a CRLF with a stray blank line, which can arrive just before the next reply;
 *   the grace window keeps that from being misread as `UnknownParameter`.
 *
 * Multi-line commands (`help`, `status`, `dump_log*`) collect lines until the reply has been
 * quiet for `idleMs`, capped by `multiLineMaxMs` and `multiLineMaxLines`.
 *
 * After a timeout the caller gets `Timeout` at once, but the queue is held ("quarantine") until
 * the late reply shows up (a matching or blank line, or for multi-line commands a quiet gap after
 * some output) or `quarantineMs` passes. The unit answers in order, so this keeps a late reply
 * from being taken as the answer to the next command.
 */
import { connect as netConnect, type Socket } from "node:net";
import { DEFAULT_EOL, DEFAULT_PORT } from "../contracts.ts";
import { NotConnected, Timeout, UnknownParameter } from "../errors.ts";
import { LineSplitter, parseReplyLine } from "./framing.ts";

export const CLIENT_DEFAULTS = {
  connectTimeoutMs: 5000,
  commandTimeoutMs: 2000,
  idleMs: 300,
  blankGraceMs: 50,
  multiLineMaxMs: 10_000,
  multiLineMaxLines: 10_000,
} as const;

export interface Cp750ClientOptions {
  host: string;
  /** Default 61408. */
  port?: number;
  /** Command terminator. Default `\r\n`. */
  eol?: string;
  /** TCP connect timeout. Default 5000. */
  connectTimeoutMs?: number;
  /** How long to wait for a reply (for multi-line commands: for the first line). Default 2000. */
  commandTimeoutMs?: number;
  /** Multi-line replies end after this much silence. Default 300. */
  idleMs?: number;
  /** How long a blank line must stand unanswered before it means "unknown parameter". Default 50. */
  blankGraceMs?: number;
  /** Hard cap on one multi-line reply. Default 10000. */
  multiLineMaxMs?: number;
  /** Hard cap on the number of lines in one multi-line reply. Default 10000. */
  multiLineMaxLines?: number;
  /** How long the queue waits for a timed-out request's late reply. Default 3 × `commandTimeoutMs`. */
  quarantineMs?: number;
  /** Lines that arrive while nothing is waiting for them, or that a request ignored. */
  onUnsolicited?: (line: string) => void;
}

export interface QueryReply {
  /** Lowercased key of the reply line (the param). */
  key: string;
  /** The value part, trimmed, NULs stripped. */
  value: string;
  /** The whole reply line, NULs stripped. */
  line: string;
}

type Expect = { kind: "single"; key: string } | { kind: "multi" };

interface Job {
  line: string;
  expect: Expect;
  resolve: (value: QueryReply | string[]) => void;
  reject: (error: Error) => void;
}

interface Active {
  job: Job;
  lines: string[];
  sawBlank: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  idle: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

interface Quarantine {
  expect: Expect;
  sawLine: boolean;
  idle: ReturnType<typeof setTimeout> | null;
  cap: ReturnType<typeof setTimeout>;
}

type Settings = Required<Omit<Cp750ClientOptions, "onUnsolicited" | "quarantineMs">> & {
  quarantineMs: number;
};

export class Cp750Client {
  private readonly socket: Socket;
  private readonly settings: Settings;
  private readonly onUnsolicited: ((line: string) => void) | undefined;
  private readonly splitter = new LineSplitter();
  private readonly queue: Job[] = [];
  private active: Active | null = null;
  private quarantine: Quarantine | null = null;
  private isClosed = false;
  private closeError: Error | null = null;
  private readonly closedPromise: Promise<Error | null>;

  /** Opens the socket. Rejects with `NotConnected` or `Timeout` when it cannot connect. */
  static connect(options: Cp750ClientOptions): Promise<Cp750Client> {
    const settings = resolveSettings(options);
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host: settings.host, port: settings.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Timeout(settings.connectTimeoutMs, `connect ${settings.host}:${settings.port}`));
      }, settings.connectTimeoutMs);
      const onError = (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(
          new NotConnected(`Cannot connect to ${settings.host}:${settings.port}: ${error.message}`),
        );
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve(new Cp750Client(socket, settings, options.onUnsolicited));
      });
    });
  }

  private constructor(
    socket: Socket,
    settings: Settings,
    onUnsolicited: ((line: string) => void) | undefined,
  ) {
    this.socket = socket;
    this.settings = settings;
    this.onUnsolicited = onUnsolicited;
    socket.setEncoding("latin1");
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    socket.on("data", (chunk: string) => {
      for (const line of this.splitter.push(chunk)) this.handleLine(line);
    });
    this.closedPromise = new Promise((resolve) => {
      socket.on("error", (error) => {
        this.closeError ??= error;
      });
      socket.on("close", () => {
        this.teardown(this.closeError ? `Connection lost: ${this.closeError.message}` : undefined);
        resolve(this.closeError);
      });
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Resolves when the socket has closed, with the socket error if there was one. */
  get done(): Promise<Error | null> {
    return this.closedPromise;
  }

  /** `<param> ?`. Throws `UnknownParameter` on a blank reply. */
  query(param: string): Promise<QueryReply> {
    const key = param.trim().toLowerCase();
    return this.enqueue(`${key} ?`, { kind: "single", key }) as Promise<QueryReply>;
  }

  /** `<param> <value>`. Returns the echo; the caller compares it. */
  set(param: string, wireValue: string): Promise<QueryReply> {
    const key = param.trim().toLowerCase();
    return this.enqueue(`${key} ${wireValue}`, { kind: "single", key }) as Promise<QueryReply>;
  }

  /** A multi-line command (`help`, `status`, `dump_log`, `dump_log_100`). Leading and trailing blank lines are dropped. */
  multi(command: string): Promise<string[]> {
    return this.enqueue(command.trim(), { kind: "multi" }) as Promise<string[]>;
  }

  /**
   * Fails queued and in-flight requests with `NotConnected`, sends `exit`, and closes the socket
   * (waits up to `waitMs` for the unit to close it, then destroys it).
   */
  async close(waitMs = 500): Promise<void> {
    if (this.isClosed) return;
    this.teardown("Connection closed");
    if (!this.socket.destroyed && this.socket.writable) {
      this.socket.write(`exit${this.settings.eol}`, "latin1");
      this.socket.end();
    }
    const timer = setTimeout(() => this.socket.destroy(), waitMs);
    await this.closedPromise;
    clearTimeout(timer);
  }

  /** Drops the socket without `exit`. */
  destroy(): void {
    this.teardown("Connection closed");
    this.socket.destroy();
  }

  // ---- queue ----

  private enqueue(line: string, expect: Expect): Promise<QueryReply | string[]> {
    if (this.isClosed) return Promise.reject(new NotConnected());
    return new Promise((resolve, reject) => {
      this.queue.push({ line, expect, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.isClosed || this.active || this.quarantine) return;
    const job = this.queue.shift();
    if (!job) return;
    const active: Active = {
      job,
      lines: [],
      sawBlank: false,
      timers: new Set(),
      idle: null,
      settled: false,
    };
    this.active = active;
    this.addTimer(active, this.settings.commandTimeoutMs, () => this.onCommandTimeout(active));
    if (job.expect.kind === "multi") {
      this.addTimer(active, this.settings.multiLineMaxMs, () => this.finishMulti(active));
    }
    this.socket.write(`${job.line}${this.settings.eol}`, "latin1");
  }

  private addTimer(active: Active, ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      active.timers.delete(timer);
      fn();
    }, ms);
    active.timers.add(timer);
  }

  private settle(active: Active, outcome: { value: QueryReply | string[] } | { error: Error }) {
    if (active.settled) return;
    active.settled = true;
    for (const timer of active.timers) clearTimeout(timer);
    if (active.idle) clearTimeout(active.idle);
    if (this.active === active) this.active = null;
    if ("error" in outcome) active.job.reject(outcome.error);
    else active.job.resolve(outcome.value);
    queueMicrotask(() => this.pump());
  }

  // ---- reply handling ----

  private handleLine(line: string): void {
    if (this.quarantine) {
      this.handleQuarantineLine(this.quarantine, line);
      return;
    }
    const active = this.active;
    if (!active) {
      if (line.trim() !== "") this.onUnsolicited?.(line);
      return;
    }
    if (active.job.expect.kind === "multi") {
      this.handleMultiLine(active, line);
      return;
    }
    const want = active.job.expect.key;
    const parsed = parseReplyLine(line);
    if (!parsed) {
      if (active.sawBlank) return;
      active.sawBlank = true;
      if (this.settings.blankGraceMs <= 0) this.rejectUnknown(active);
      else this.addTimer(active, this.settings.blankGraceMs, () => this.rejectUnknown(active));
      return;
    }
    if (parsed.key === want) {
      this.settle(active, { value: { key: parsed.key, value: parsed.value, line: line.trim() } });
      return;
    }
    this.onUnsolicited?.(line);
  }

  private rejectUnknown(active: Active): void {
    const key = active.job.expect.kind === "single" ? active.job.expect.key : active.job.line;
    this.settle(active, { error: new UnknownParameter(key, "got a blank reply") });
  }

  private handleMultiLine(active: Active, line: string): void {
    // Every line, blank or not, counts as activity; blank ends are trimmed when the reply ends.
    active.lines.push(line);
    if (active.idle) clearTimeout(active.idle);
    if (active.lines.length >= this.settings.multiLineMaxLines) {
      this.finishMulti(active);
      return;
    }
    active.idle = setTimeout(() => this.finishMulti(active), this.settings.idleMs);
  }

  private finishMulti(active: Active): void {
    this.settle(active, { value: trimBlankEnds(active.lines) });
  }

  private onCommandTimeout(active: Active): void {
    if (active.job.expect.kind === "multi") {
      // The timeout only covers the first line; once output started, the idle gap ends it.
      if (active.lines.length > 0) return;
    } else if (active.sawBlank) {
      this.rejectUnknown(active);
      return;
    }
    this.quarantine = this.startQuarantine(active.job.expect);
    this.settle(active, { error: new Timeout(this.settings.commandTimeoutMs, active.job.line) });
  }

  private startQuarantine(expect: Expect): Quarantine {
    return {
      expect,
      sawLine: false,
      idle: null,
      cap: setTimeout(() => this.endQuarantine(), this.settings.quarantineMs),
    };
  }

  private handleQuarantineLine(q: Quarantine, line: string): void {
    if (q.expect.kind === "multi") {
      q.sawLine = true;
      if (q.idle) clearTimeout(q.idle);
      q.idle = setTimeout(() => this.endQuarantine(), this.settings.idleMs);
      return;
    }
    const parsed = parseReplyLine(line);
    if (!parsed || parsed.key === q.expect.key) {
      this.endQuarantine();
      return;
    }
    this.onUnsolicited?.(line);
  }

  private endQuarantine(): void {
    const q = this.quarantine;
    if (!q) return;
    clearTimeout(q.cap);
    if (q.idle) clearTimeout(q.idle);
    this.quarantine = null;
    this.pump();
  }

  private teardown(message = "Connection closed"): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.quarantine) {
      clearTimeout(this.quarantine.cap);
      if (this.quarantine.idle) clearTimeout(this.quarantine.idle);
      this.quarantine = null;
    }
    if (this.active) this.settle(this.active, { error: new NotConnected(message) });
    for (const job of this.queue.splice(0)) job.reject(new NotConnected(message));
  }
}

function resolveSettings(options: Cp750ClientOptions): Settings {
  const commandTimeoutMs = options.commandTimeoutMs ?? CLIENT_DEFAULTS.commandTimeoutMs;
  return {
    host: options.host,
    port: options.port ?? DEFAULT_PORT,
    eol: options.eol ?? DEFAULT_EOL,
    connectTimeoutMs: options.connectTimeoutMs ?? CLIENT_DEFAULTS.connectTimeoutMs,
    commandTimeoutMs,
    idleMs: options.idleMs ?? CLIENT_DEFAULTS.idleMs,
    blankGraceMs: options.blankGraceMs ?? CLIENT_DEFAULTS.blankGraceMs,
    multiLineMaxMs: options.multiLineMaxMs ?? CLIENT_DEFAULTS.multiLineMaxMs,
    multiLineMaxLines: options.multiLineMaxLines ?? CLIENT_DEFAULTS.multiLineMaxLines,
    quarantineMs: options.quarantineMs ?? 3 * commandTimeoutMs,
  };
}

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start++;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end);
}
