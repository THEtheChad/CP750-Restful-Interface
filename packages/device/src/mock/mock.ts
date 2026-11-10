/**
 * A manifest-driven mock CP750: a real TCP server speaking the ASCII protocol
 * (docs/ARCHITECTURE.md, "Mock CP750"). Values are shared by all connections (one unit); the
 * full command set (`cp750.ctrl.full_ascii_ctrl`) is per connection, as the manual describes it
 * ("for this session").
 */
import { createServer, type Server, type Socket } from "node:net";
import {
  decode,
  findParam,
  type Manifest,
  type ParamSpec,
  type ParamValue,
  type ValueSchema,
  validateValue,
} from "@cp750/manifests";
import { LineSplitter } from "../protocol/framing.ts";

const FULL_CONTROL = "cp750.ctrl.full_ascii_ctrl";
const VERSION = "cp750.sysinfo.version";
const VERSION_SPEC: ParamSpec = {
  tier: "normal",
  access: "readonly",
  accessSource: "inferred",
  value: { type: "string" },
};
const SINGLE_WORD = ["help", "status", "dump_log", "dump_log_100", "exit"] as const;

export const EVICTION_WARNING =
  "WARNING: maximum number of sessions exceeded, this session is being closed";

export interface MockCp750Options {
  manifest: Manifest;
  /** 0 (default) picks a random free port. */
  port?: number;
  /** Default `127.0.0.1`. */
  host?: string;
  /** Delay before each reply. Replies on one connection stay in order. Default 0. */
  latencyMs?: number;
  /** Sprinkle NUL bytes through every reply line. */
  nulBytes?: boolean;
  /** Write every reply line in two TCP chunks, splitting its CRLF. */
  fragmented?: boolean;
  /**
   * Treat CR and LF as separate terminators and answer the resulting empty line with a blank
   * line, so a client sending `\r\n` gets a stray blank line after every reply.
   */
  blankForEmptyLines?: boolean;
  /** Initial values by name (or alias). `cp750.sysinfo.version` overrides the reported firmware. */
  initial?: Record<string, string | number>;
  /** Simultaneous sessions before the oldest is kicked. Default 20. */
  maxSessions?: number;
  /** How long a kicked session stays open after its warning line. Default 50. */
  evictionDelayMs?: number;
}

export interface MockCp750 {
  readonly port: number;
  readonly host: string;
  /** Live values by canonical name, shared by all connections. Tests may change them. */
  readonly state: Map<string, ParamValue>;
  /** Open sessions (kicked sessions no longer count). */
  readonly connections: number;
  /** Every non-empty command line received, trimmed, in arrival order. */
  readonly received: string[];
  /** Reply delay; can be changed while running. */
  latencyMs: number;
  /** Drops every connection without a word, as a network failure would. */
  dropConnections(): void;
  close(): Promise<void>;
}

interface Connection {
  socket: Socket;
  full: boolean;
  chain: Promise<void>;
}

/** Starts the mock and resolves once it is listening. */
export async function startMockCp750(options: MockCp750Options): Promise<MockCp750> {
  const device = new MockDevice(options);
  await device.listen(options.port ?? 0, options.host ?? "127.0.0.1");
  return device;
}

/** Default values: the first enum member, else 0 if allowed, else the minimum; strings `""`. */
export function mockDefaultValue(schema: ValueSchema): ParamValue {
  if (schema.enum?.[0] !== undefined) return schema.enum[0];
  if (schema.type === "string") return "";
  const { minimum, maximum } = schema;
  if ((minimum === undefined || minimum <= 0) && (maximum === undefined || maximum >= 0)) return 0;
  return minimum ?? maximum ?? 0;
}

class MockDevice implements MockCp750 {
  readonly state = new Map<string, ParamValue>();
  readonly received: string[] = [];
  latencyMs: number;
  host = "127.0.0.1";
  port = 0;

  private readonly manifest: Manifest;
  private readonly options: MockCp750Options;
  private readonly server: Server;
  private readonly live: Connection[] = [];
  private readonly sockets = new Set<Socket>();

  constructor(options: MockCp750Options) {
    this.options = options;
    this.manifest = options.manifest;
    this.latencyMs = options.latencyMs ?? 0;
    for (const [name, spec] of Object.entries(this.manifest.params)) {
      if (name !== FULL_CONTROL) this.state.set(name, mockDefaultValue(spec.value));
    }
    this.state.set(VERSION, this.manifest.firmware);
    for (const [input, value] of Object.entries(options.initial ?? {})) {
      const name = findParam(this.manifest, input)?.name ?? input.trim().toLowerCase();
      if (name !== VERSION && !this.manifest.params[name]) {
        throw new Error(`mock CP750: initial value for unknown param ${input}`);
      }
      this.state.set(name, value);
    }
    this.server = createServer((socket) => this.accept(socket));
  }

  get connections(): number {
    return this.live.length;
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (address && typeof address === "object") {
          this.port = address.port;
          this.host = address.address;
        }
        resolve();
      });
    });
  }

  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy();
  }

  close(): Promise<void> {
    this.dropConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // ---- connections ----

  private accept(socket: Socket): void {
    const max = this.options.maxSessions ?? 20;
    if (this.live.length >= max) {
      const oldest = this.live.shift();
      if (oldest) {
        oldest.socket.write(`${EVICTION_WARNING}\r\n`, "latin1");
        setTimeout(() => oldest.socket.destroy(), this.options.evictionDelayMs ?? 50);
      }
    }
    const conn: Connection = { socket, full: false, chain: Promise.resolve() };
    this.live.push(conn);
    this.sockets.add(socket);
    socket.setEncoding("latin1");
    socket.setNoDelay(true);
    const splitter = new LineSplitter();
    const lines = this.options.blankForEmptyLines
      ? splitEachTerminator()
      : (chunk: string) => splitter.push(chunk);
    socket.on("data", (chunk: string) => {
      for (const line of lines(chunk)) this.enqueue(conn, line);
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      this.sockets.delete(socket);
      const index = this.live.indexOf(conn);
      if (index >= 0) this.live.splice(index, 1);
    });
  }

  private enqueue(conn: Connection, line: string): void {
    conn.chain = conn.chain
      .then(async () => {
        const reply = this.respond(conn, line);
        if (this.latencyMs > 0) await sleep(this.latencyMs);
        if (conn.socket.destroyed) return;
        if (reply === "exit") {
          conn.socket.end();
          return;
        }
        for (const out of reply) await this.writeLine(conn.socket, out);
      })
      .catch(() => {});
  }

  private async writeLine(socket: Socket, line: string): Promise<void> {
    const text = this.options.nulBytes ? addNuls(line) : line;
    if (this.options.fragmented) {
      socket.write(`${text}\r`, "latin1");
      await sleep(1);
      if (!socket.destroyed) socket.write("\n", "latin1");
    } else {
      socket.write(`${text}\r\n`, "latin1");
    }
  }

  // ---- protocol ----

  private respond(conn: Connection, line: string): string[] | "exit" {
    const text = line.trim();
    if (text === "") return this.options.blankForEmptyLines ? [""] : [];
    this.received.push(text);
    const head = /^\S+/.exec(text)?.[0] ?? "";
    const command = head.toLowerCase();
    const argument = text.slice(head.length).trim();

    if (argument === "") {
      switch (command) {
        case "help":
          return this.help(conn);
        case "status":
          return this.status(conn);
        case "dump_log":
        case "dump_log_100":
          return ["0001 00:00:00 power on", "0002 00:00:01 mock CP750 ready", ""];
        case "exit":
          return "exit";
        default:
          return [""];
      }
    }

    const spec = this.visibleSpec(conn, command);
    if (!spec) return [""];
    if (argument === "?") return [`${command} ${this.valueOf(conn, command)}`];

    if (command === FULL_CONTROL) {
      if (argument === "0" || argument === "1") conn.full = argument === "1";
      return [`${command} ${conn.full ? 1 : 0}`];
    }
    if (spec.access !== "readonly") {
      try {
        const value = decode(spec, argument);
        if (validateValue(spec, value).ok) this.state.set(command, value);
      } catch {
        // An unrecognized value is ignored; the reply is the current value.
      }
    }
    return [`${command} ${this.valueOf(conn, command)}`];
  }

  /** The spec of a param this connection can see, or `null` (the unit treats it as unknown). */
  private visibleSpec(conn: Connection, name: string): ParamSpec | null {
    const spec = this.manifest.params[name] ?? (name === VERSION ? VERSION_SPEC : undefined);
    if (!spec) return null;
    if (spec.tier === "full" && !conn.full) return null;
    return spec;
  }

  private visibleParams(conn: Connection): [string, ParamSpec][] {
    const names = new Set([VERSION, ...Object.keys(this.manifest.params)]);
    return [...names].sort().flatMap((name) => {
      const spec = this.visibleSpec(conn, name);
      return spec ? [[name, spec] as [string, ParamSpec]] : [];
    });
  }

  private valueOf(conn: Connection, name: string): string {
    if (name === FULL_CONTROL) return conn.full ? "1" : "0";
    return String(this.state.get(name) ?? "");
  }

  private help(conn: Connection): string[] {
    const set = conn.full ? "full" : "normal";
    const lines = [`Dolby CP750 ASCII commands (${set} set):`];
    for (const [name, spec] of this.visibleParams(conn)) {
      lines.push(`  ${name.padEnd(40)} ${describeValues(spec.value)}`);
    }
    lines.push("Commands:");
    for (const word of SINGLE_WORD) lines.push(`  ${word}`);
    lines.push("");
    return lines;
  }

  private status(conn: Connection): string[] {
    const lines = this.visibleParams(conn)
      .filter(([, spec]) => spec.access !== "action")
      .map(([name]) => `${name} : ${this.valueOf(conn, name)}`);
    return [...lines, ""];
  }
}

function describeValues(schema: ValueSchema): string {
  if (schema.enum) return schema.enum.join(" | ");
  if (schema.type === "integer") {
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      return `${schema.minimum} to ${schema.maximum}`;
    }
    return "integer";
  }
  return schema["x-format"] ? `[${schema["x-format"]}]` : "text";
}

/** Inserts NULs before, inside and after a line, as some units pad replies. */
function addNuls(line: string): string {
  if (line === "") return "\u0000\u0000";
  return `\u0000${line.replace(" ", "\u0000 ")}\u0000\u0000`;
}

/** CR and LF are separate terminators, so CRLF yields an extra empty line. */
function splitEachTerminator(): (chunk: string) => string[] {
  let buffer = "";
  return (chunk) => {
    const out: string[] = [];
    for (const char of chunk) {
      if (char === "\r" || char === "\n") {
        out.push(buffer);
        buffer = "";
      } else buffer += char;
    }
    return out;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
