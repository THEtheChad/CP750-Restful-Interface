/**
 * The CP750 protocol client: one persistent TCP socket, a strict FIFO queue with one request in
 * flight, per-request timeouts, and reply matching (docs/ARCHITECTURE.md, "Session").
 *
 * The protocol has no request ids and no end-of-reply marker, but the unit answers in order. The
 * client relies on that and never lets an ambiguous reply release the queue:
 *
 * - **Single-line requests** (`<param> ?`, `<param> <value>`): the reply is the first line whose
 *   key (first token, case-insensitive) is the param. Other non-blank lines (the 21st-session
 *   warning, unsolicited text) are ignored.
 * - **Blank lines are ambiguous.** A blank line means "unknown parameter", but a unit that treats
 *   CR and LF as two terminators also answers the LF of a CRLF with a stray blank line, which
 *   arrives just before the next reply, however slow that reply is. So a blank line never
 *   resolves a request by itself. If no matching line follows within `blankGraceMs`, the client
 *   sends a **sync query** (`cp750.sysinfo.version ?`, or `cp750.sys.fader ?` when the request is
 *   for the version) and holds the queue until the sync reply arrives. Everything before it
 *   belongs to the request: a matching line is the reply, otherwise the request's answer was the
 *   blank line and it fails with `UnknownParameter`.
 * - **Timeouts.** After `commandTimeoutMs` without a reply the caller gets `Timeout`, and the
 *   client sends a sync query and holds the queue the same way, so a late reply cannot be taken
 *   as the answer to the next request.
 * - **Lost sync.** If the sync reply does not arrive within `quarantineMs`, the client resets the
 *   connection: it destroys the socket and rejects the request and everything queued with
 *   `NotConnected`. Nothing is replayed. (The session reconnects and re-detects the firmware.)
 * - **Multi-line commands** (`help`, `status`, `dump_log*`) have no reliable sync (any param line
 *   can be part of the reply), so they end after `idleMs` of silence. A reply that is still
 *   arriving at `multiLineMaxMs`, or that grows past `multiLineMaxLines`, fails with
 *   `ReplyTruncated` and resets the connection. A multi-line command that times out holds the
 *   queue until its output has started and gone quiet, or resets the connection after
 *   `quarantineMs`.
 *
 * Every line written is checked to be printable ASCII (0x20–0x7E) before the terminator is
 * appended, and is written as ASCII.
 */
import { connect as netConnect, type Socket } from "node:net";
import { DEFAULT_EOL, DEFAULT_PORT } from "../contracts.ts";
import {
  InvalidValue,
  NotConnected,
  ReplyTruncated,
  Timeout,
  UnknownParameter,
} from "../errors.ts";
import { LineSplitter, parseReplyLine } from "./framing.ts";

export const CLIENT_DEFAULTS = {
  connectTimeoutMs: 5000,
  commandTimeoutMs: 2000,
  idleMs: 300,
  blankGraceMs: 50,
  multiLineMaxMs: 10_000,
  multiLineMaxLines: 10_000,
} as const;

/**
 * The read-only queries used to re-synchronize after an ambiguous reply: the first, or the second
 * when the request in flight is for the first. Both are in the normal command set.
 */
export const SYNC_PARAMS = ["cp750.sysinfo.version", "cp750.sys.fader"] as const;

/** Terminators the client may append. */
const EOLS = new Set(["\r\n", "\n", "\r", "\n\r"]);
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const NOT_PRINTABLE = /[^\x20-\x7e]/;
/** A param name as sent on the wire: no whitespace, no `?`. */
const WIRE_KEY = /^[^\s?]+$/;

export interface Cp750ClientOptions {
  host: string;
  /** Default 61408. */
  port?: number;
  /** Command terminator: `\r\n` (default), `\n`, `\r` or `\n\r`. */
  eol?: string;
  /** TCP connect timeout. Default 5000. */
  connectTimeoutMs?: number;
  /** How long to wait for a reply (for multi-line commands: for the first line). Default 2000. */
  commandTimeoutMs?: number;
  /** Multi-line replies end after this much silence. Default 300. */
  idleMs?: number;
  /**
   * How long a blank line waits for a matching line before the client sends a sync query to find
   * out whether it was the reply. Default 50.
   */
  blankGraceMs?: number;
  /** A multi-line reply still arriving after this long fails with `ReplyTruncated`. Default 10000. */
  multiLineMaxMs?: number;
  /** A multi-line reply longer than this fails with `ReplyTruncated`. Default 10000. */
  multiLineMaxLines?: number;
  /**
   * How long the queue is held waiting for a sync reply (or a timed-out multi-line reply) before
   * the connection is reset. Default 3 × `commandTimeoutMs`.
   */
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
type Timer = ReturnType<typeof setTimeout>;

interface Job {
  line: string;
  expect: Expect;
  resolve: (value: QueryReply | string[]) => void;
  reject: (error: Error) => void;
}

interface SlotBase {
  job: Job;
  /** The caller has its answer (value or error). The slot may still hold the queue. */
  settled: boolean;
  timers: Set<Timer>;
}

interface SingleSlot extends SlotBase {
  kind: "single";
  key: string;
  matched: boolean;
  blankSeen: boolean;
  /** The param of the sync query sent for this slot, or `null`. */
  syncKey: string | null;
}

interface MultiSlot extends SlotBase {
  kind: "multi";
  lines: string[];
  idle: Timer | null;
}

type Slot = SingleSlot | MultiSlot;

type Settings = Required<Omit<Cp750ClientOptions, "onUnsolicited" | "quarantineMs">> & {
  quarantineMs: number;
};

/**
 * Throws `InvalidValue` unless `line` is non-empty printable ASCII (0x20–0x7E). Every line the
 * client writes goes through this, so no input can smuggle a terminator onto the wire.
 */
export function assertWireLine(line: string, param = line): void {
  if (!PRINTABLE_ASCII.test(line)) {
    throw new InvalidValue(param, line, [
      "refusing to send a command line that is empty or contains a character outside printable ASCII (0x20-0x7E)",
    ]);
  }
}

export class Cp750Client {
  private readonly socket: Socket;
  private readonly settings: Settings;
  private readonly onUnsolicited: ((line: string) => void) | undefined;
  private readonly splitter = new LineSplitter();
  private readonly queue: Job[] = [];
  private slot: Slot | null = null;
  private isClosed = false;
  private closeError: Error | null = null;
  private readonly closedPromise: Promise<Error | null>;

  /** Opens the socket. Rejects with `NotConnected` or `Timeout` when it cannot connect. */
  static connect(options: Cp750ClientOptions): Promise<Cp750Client> {
    let settings: Settings;
    try {
      settings = resolveSettings(options);
    } catch (error) {
      return Promise.reject(error);
    }
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
    // Replies are decoded byte-for-byte; requests are checked to be ASCII before they are written.
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

  /** Resolves when the socket has closed, with the socket error (or reset reason) if there was one. */
  get done(): Promise<Error | null> {
    return this.closedPromise;
  }

  /** `<param> ?`. Throws `UnknownParameter` when the unit answers with a blank line. */
  query(param: string): Promise<QueryReply> {
    const key = param.trim().toLowerCase();
    return this.enqueue(`${key} ?`, { kind: "single", key }, param) as Promise<QueryReply>;
  }

  /** `<param> <value>`. Returns the echo; the caller compares it. */
  set(param: string, wireValue: string): Promise<QueryReply> {
    const key = param.trim().toLowerCase();
    return this.enqueue(
      `${key} ${wireValue}`,
      { kind: "single", key },
      param,
    ) as Promise<QueryReply>;
  }

  /** A multi-line command (`help`, `status`, `dump_log`, `dump_log_100`). Leading and trailing blank lines are dropped. */
  multi(command: string): Promise<string[]> {
    return this.enqueue(command.trim(), { kind: "multi" }, command) as Promise<string[]>;
  }

  /**
   * Fails queued and in-flight requests with `NotConnected`, sends `exit`, and closes the socket
   * (waits up to `waitMs` for the unit to close it, then destroys it).
   */
  async close(waitMs = 500): Promise<void> {
    if (this.isClosed) return;
    this.teardown("Connection closed");
    if (!this.socket.destroyed && this.socket.writable) {
      this.socket.write(`exit${this.settings.eol}`, "ascii");
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

  private enqueue(line: string, expect: Expect, param: string): Promise<QueryReply | string[]> {
    try {
      // Checked before trimming too: refuse, rather than silently normalize, unsafe input.
      if (NOT_PRINTABLE.test(param)) assertWireLine(param);
      if (expect.kind === "single" && !WIRE_KEY.test(expect.key)) {
        throw new InvalidValue(param, param, ["a param name cannot contain whitespace or '?'"]);
      }
      assertWireLine(line, param);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.isClosed) return Promise.reject(new NotConnected());
    return new Promise((resolve, reject) => {
      this.queue.push({ line, expect, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.isClosed || this.slot) return;
    const job = this.queue.shift();
    if (!job) return;
    const base = { job, settled: false, timers: new Set<Timer>() };
    if (job.expect.kind === "single") {
      const slot: SingleSlot = {
        ...base,
        kind: "single",
        key: job.expect.key,
        matched: false,
        blankSeen: false,
        syncKey: null,
      };
      this.slot = slot;
      this.addTimer(slot, this.settings.commandTimeoutMs, () => this.onSingleTimeout(slot));
    } else {
      const slot: MultiSlot = { ...base, kind: "multi", lines: [], idle: null };
      this.slot = slot;
      this.addTimer(slot, this.settings.commandTimeoutMs, () => this.onMultiTimeout(slot));
      this.addTimer(slot, this.settings.multiLineMaxMs, () => this.truncate(slot, "time"));
    }
    this.writeLine(job.line);
  }

  /** Writes one checked line plus the terminator, as ASCII. */
  private writeLine(line: string): void {
    assertWireLine(line);
    this.socket.write(`${line}${this.settings.eol}`, "ascii");
  }

  private addTimer(slot: Slot, ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      slot.timers.delete(timer);
      fn();
    }, ms);
    slot.timers.add(timer);
  }

  /** Gives the caller its answer. Does not release the queue. */
  private answer(slot: Slot, outcome: { value: QueryReply | string[] } | { error: Error }): void {
    if (slot.settled) return;
    slot.settled = true;
    if ("error" in outcome) slot.job.reject(outcome.error);
    else slot.job.resolve(outcome.value);
  }

  /** Frees the queue for the next request. */
  private release(slot: Slot): void {
    for (const timer of slot.timers) clearTimeout(timer);
    slot.timers.clear();
    if (slot.kind === "multi" && slot.idle) clearTimeout(slot.idle);
    if (this.slot !== slot) return;
    this.slot = null;
    queueMicrotask(() => this.pump());
  }

  // ---- reply handling ----

  private handleLine(line: string): void {
    if (this.isClosed) return;
    const slot = this.slot;
    if (!slot) {
      // A blank line here is the stray answer to a CRLF's LF; nothing is waiting for it.
      if (line.trim() !== "") this.onUnsolicited?.(line);
      return;
    }
    if (slot.kind === "multi") this.onMultiLine(slot, line);
    else this.onSingleLine(slot, line);
  }

  private onSingleLine(slot: SingleSlot, line: string): void {
    const parsed = parseReplyLine(line);
    if (!parsed) {
      // Ambiguous: the reply to this request, or a stray from the previous CRLF. Decide with a
      // sync query unless the matching line follows within the grace window.
      if (slot.matched || slot.blankSeen || slot.syncKey !== null) return;
      slot.blankSeen = true;
      this.addTimer(slot, this.settings.blankGraceMs, () => {
        if (!slot.matched) this.sync(slot);
      });
      return;
    }
    if (slot.syncKey !== null && parsed.key === slot.syncKey) {
      this.onSyncReply(slot);
      return;
    }
    if (parsed.key === slot.key && !slot.matched) {
      slot.matched = true;
      // After a timeout the caller already has its `Timeout`; the late reply is only consumed.
      this.answer(slot, { value: { key: parsed.key, value: parsed.value, line: line.trim() } });
      if (slot.syncKey === null) this.release(slot);
      return;
    }
    this.onUnsolicited?.(line);
  }

  private onSingleTimeout(slot: SingleSlot): void {
    if (slot.settled) return;
    this.answer(slot, { error: new Timeout(this.settings.commandTimeoutMs, slot.job.line) });
    this.sync(slot);
  }

  /** Sends the sync query for `slot` and holds the queue until it is answered. */
  private sync(slot: SingleSlot): void {
    if (slot.syncKey !== null || this.isClosed || this.slot !== slot) return;
    const syncKey = slot.key === SYNC_PARAMS[0] ? SYNC_PARAMS[1] : SYNC_PARAMS[0];
    slot.syncKey = syncKey;
    this.writeLine(`${syncKey} ?`);
    this.addTimer(slot, this.settings.quarantineMs, () => {
      this.answer(slot, { error: new Timeout(this.settings.commandTimeoutMs, slot.job.line) });
      this.reset(
        `no reply to the sync query "${syncKey} ?" within ${this.settings.quarantineMs} ms`,
      );
    });
  }

  /** The unit answered the sync query, so it has answered the request too. */
  private onSyncReply(slot: SingleSlot): void {
    if (!slot.matched) {
      this.answer(slot, {
        error: slot.blankSeen
          ? new UnknownParameter(slot.key, "got a blank reply")
          : new Timeout(this.settings.commandTimeoutMs, slot.job.line),
      });
    }
    this.release(slot);
  }

  private onMultiLine(slot: MultiSlot, line: string): void {
    // Every line, blank or not, counts as activity; blank ends are trimmed when the reply ends.
    slot.lines.push(line);
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = null;
    if (slot.lines.length > this.settings.multiLineMaxLines) {
      this.truncate(slot, "lines");
      return;
    }
    slot.idle = setTimeout(() => this.finishMulti(slot), this.settings.idleMs);
  }

  private finishMulti(slot: MultiSlot): void {
    this.answer(slot, { value: trimBlankEnds(slot.lines) });
    this.release(slot);
  }

  private onMultiTimeout(slot: MultiSlot): void {
    // The timeout only covers the first line; once output started, the idle gap ends it.
    if (slot.lines.length > 0 || slot.settled) return;
    this.answer(slot, { error: new Timeout(this.settings.commandTimeoutMs, slot.job.line) });
    // Hold the queue until the late reply has arrived and gone quiet (`finishMulti`).
    this.addTimer(slot, this.settings.quarantineMs, () =>
      this.reset(`no reply to "${slot.job.line}" within ${this.settings.quarantineMs} ms`),
    );
  }

  /** A multi-line limit was hit: the rest of the reply is unaccounted for, so reset. */
  private truncate(slot: MultiSlot, limit: "time" | "lines"): void {
    const max = limit === "time" ? this.settings.multiLineMaxMs : this.settings.multiLineMaxLines;
    const lines = trimBlankEnds(slot.lines.slice(0, this.settings.multiLineMaxLines));
    this.answer(slot, { error: new ReplyTruncated(slot.job.line, lines, limit, max) });
    this.reset(`the reply to "${slot.job.line}" was cut off`);
  }

  /** Destroys the connection: the reply stream can no longer be matched to requests. */
  private reset(reason: string): void {
    if (this.isClosed) return;
    this.closeError ??= new Error(reason);
    this.teardown(`Connection reset: ${reason}`);
    this.socket.destroy();
  }

  private teardown(message = "Connection closed"): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const slot = this.slot;
    if (slot) {
      const silent = slot.kind === "single" ? !slot.matched && !slot.blankSeen : !slot.lines.length;
      this.answer(slot, { error: new NotConnected(message, { inFlight: silent }) });
      this.release(slot);
    }
    for (const job of this.queue.splice(0)) job.reject(new NotConnected(message));
  }
}

function resolveSettings(options: Cp750ClientOptions): Settings {
  const commandTimeoutMs = options.commandTimeoutMs ?? CLIENT_DEFAULTS.commandTimeoutMs;
  const eol = options.eol ?? DEFAULT_EOL;
  if (!EOLS.has(eol)) {
    throw new TypeError(`Unsupported command terminator ${JSON.stringify(eol)}`);
  }
  return {
    host: options.host,
    port: options.port ?? DEFAULT_PORT,
    eol,
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
