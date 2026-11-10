/**
 * Regression tests for the client's wire safety and reply synchronization (review findings 1–4):
 * no line with a byte outside printable ASCII reaches the socket, and no ambiguous reply (a blank
 * line, a late reply, the tail of a cut-off multi-line reply) is taken as the answer to the next
 * request.
 */
import { describe, expect, test } from "bun:test";
import {
  Cp750Client,
  InvalidValue,
  NotConnected,
  ReplyTruncated,
  SYNC_PARAMS,
  Timeout,
  UnknownParameter,
} from "../src/index.ts";
import { mock, onCleanup, rejection, scriptedServer } from "./helpers.ts";

type ClientOptions = Partial<Parameters<typeof Cp750Client.connect>[0]>;

async function client(device: { host: string; port: number }, options: ClientOptions = {}) {
  const c = await Cp750Client.connect({
    host: device.host,
    port: device.port,
    commandTimeoutMs: 300,
    idleMs: 20,
    blankGraceMs: 10,
    ...options,
  });
  onCleanup(() => c.close());
  return c;
}

const VERSION_REPLY = "cp750.sysinfo.version 1.0.0.150183";
/** Characters that must never reach the wire; U+010A/U+010D/U+0100 truncate to LF/CR/NUL in Latin-1. */
const UNSAFE = ["\u010a", "\u010d", "\u0100", "\u2028", "\n", "\r", "\u0000"];

describe("finding 1: only printable ASCII is written", () => {
  test("set/query/multi refuse any line with a byte outside 0x20–0x7E, and nothing is sent", async () => {
    const device = await mock();
    const c = await client(device);
    for (const char of UNSAFE) {
      const injected = `[L R C Sw Ls Rs 7 8]${char}cp750.ctrl.reboot 1`;
      expect(await rejection(c.set("cp750.sys.dig_1_route", injected))).toBeInstanceOf(
        InvalidValue,
      );
      expect(await rejection(c.query(`cp750.sys.fader${char}`))).toBeInstanceOf(InvalidValue);
      expect(await rejection(c.multi(`help${char}status`))).toBeInstanceOf(InvalidValue);
    }
    // A name with whitespace would let a "query" carry a value.
    expect(await rejection(c.query("cp750.sys.fader 5"))).toBeInstanceOf(InvalidValue);
    expect((await c.query("cp750.sys.fader")).value).toBe("0");
    expect(device.received).toEqual(["cp750.sys.fader ?"]);
    expect(device.state.get("cp750.ctrl.reboot")).toBe(0);
  });

  test("an unsupported terminator is refused at connect", async () => {
    const device = await mock();
    expect(
      await rejection(Cp750Client.connect({ host: device.host, port: device.port, eol: "\u010a" })),
    ).toBeInstanceOf(TypeError);
  });
});

describe("finding 2: a timeout whose late reply never comes resets the connection", () => {
  test("pending and queued requests fail with NotConnected; the late reply is never misattributed", async () => {
    // Replies to the first command 220 ms late and answers everything else (including the sync
    // query) with a fader line, so the sync reply never comes.
    const server = await scriptedServer((_line, index, send) => {
      send(`cp750.sys.fader ${index === 1 ? 11 : 12}`, index === 1 ? 220 : 100);
    });
    const c = await client(server, { commandTimeoutMs: 50 });
    const first = c.set("cp750.sys.fader", "11");
    const second = c.set("cp750.sys.fader", "12");
    const third = c.query("cp750.sys.input_mode");
    expect(await rejection(first)).toBeInstanceOf(Timeout);
    const secondError = await rejection(second);
    expect(secondError).toBeInstanceOf(NotConnected);
    expect(secondError).toMatchObject({ inFlight: false });
    expect(await rejection(third)).toBeInstanceOf(NotConnected);
    expect((await c.done)?.message).toContain("sync query");
    expect(c.closed).toBe(true);
    // The queued write was never sent: nothing is replayed.
    expect(server.received).toEqual(["cp750.sys.fader 11", `${SYNC_PARAMS[0]} ?`]);
  });

  test("a late reply inside the quarantine window releases the queue cleanly", async () => {
    const server = await scriptedServer((line, index, send) => {
      if (line === `${SYNC_PARAMS[0]} ?`) send(VERSION_REPLY);
      else send(`cp750.sys.fader ${line.split(" ")[1]}`, index === 1 ? 120 : 0);
    });
    const c = await client(server, { commandTimeoutMs: 50, quarantineMs: 300 });
    const first = c.set("cp750.sys.fader", "11");
    const second = c.set("cp750.sys.fader", "12");
    expect(await rejection(first)).toBeInstanceOf(Timeout);
    expect((await second).value).toBe("12");
    expect(c.closed).toBe(false);
  });
});

describe("finding 3: blank lines never resolve a request on their own", () => {
  test("stock mock, CR and LF answered separately, latency above the grace window", async () => {
    const device = await mock({ blankForEmptyLines: true, latencyMs: 80 });
    const c = await client(device, { commandTimeoutMs: 1000, blankGraceMs: 30 });
    const results = await Promise.all(
      ["10", "11", "12"].map((v) =>
        c.set("cp750.sys.fader", v).then(
          (r) => r.value,
          (e: { code: string }) => e.code,
        ),
      ),
    );
    expect(results).toEqual(["10", "11", "12"]);
    // A genuinely unknown param is still recognized (via the sync query), and the queue stays in step.
    expect(await rejection(c.query("cp750.sys.nope"))).toBeInstanceOf(UnknownParameter);
    expect((await c.query("cp750.sys.fader")).value).toBe("12");
    expect((await c.set("cp750.sys.fader", "13")).value).toBe("13");
  });

  test("an unknown param on a slow unit (latency above the grace window)", async () => {
    const device = await mock({ latencyMs: 60 });
    const c = await client(device, { blankGraceMs: 10 });
    expect(await rejection(c.query("cp750.sys.nope"))).toBeInstanceOf(UnknownParameter);
    expect((await c.query("cp750.sys.input_mode")).value).toBe("analog");
  });

  test("a blank reply to the version query is settled with a fader sync query", async () => {
    const server = await scriptedServer((line, _index, send) => {
      if (line === `${SYNC_PARAMS[0]} ?`) send("");
      else if (line === `${SYNC_PARAMS[1]} ?`) send("cp750.sys.fader 33");
    });
    const c = await client(server);
    expect(await rejection(c.query(SYNC_PARAMS[0]))).toBeInstanceOf(UnknownParameter);
    expect(server.received).toEqual([`${SYNC_PARAMS[0]} ?`, `${SYNC_PARAMS[1]} ?`]);
  });

  test("a blank line, then the real reply after the grace window", async () => {
    const server = await scriptedServer((line, index, send) => {
      if (line === `${SYNC_PARAMS[0]} ?`) return send(VERSION_REPLY);
      if (index === 1) send("", 10);
      send(`cp750.sys.fader ${line.split(" ")[1]}`, index === 1 ? 70 : 0);
    });
    const c = await client(server, { commandTimeoutMs: 200, blankGraceMs: 20 });
    const first = c.set("cp750.sys.fader", "11");
    const second = c.set("cp750.sys.fader", "12");
    expect((await first).value).toBe("11");
    expect((await second).value).toBe("12");
  });

  test("a blank line during the timeout quarantine does not release the queue", async () => {
    const server = await scriptedServer((line, index, send) => {
      if (line === `${SYNC_PARAMS[0]} ?`) return send(VERSION_REPLY, 30);
      if (index === 1) send("", 65);
      send(`cp750.sys.fader ${line.split(" ")[1]}`, index === 1 ? 85 : 0);
    });
    const c = await client(server, { commandTimeoutMs: 50, blankGraceMs: 20, quarantineMs: 300 });
    const first = c.set("cp750.sys.fader", "11");
    const second = c.set("cp750.sys.fader", "12");
    expect(await rejection(first)).toBeInstanceOf(Timeout);
    expect((await second).value).toBe("12");
  });

  test("a blank line whose sync query is never answered resets the connection", async () => {
    const server = await scriptedServer((line, _index, send) => {
      if (line.startsWith("cp750.sys.nope")) send("");
    });
    const c = await client(server, { commandTimeoutMs: 50, quarantineMs: 100 });
    const unknown = c.query("cp750.sys.nope");
    const next = c.query("cp750.sys.fader");
    expect(await rejection(unknown)).toBeInstanceOf(Timeout);
    expect(await rejection(next)).toBeInstanceOf(NotConnected);
    expect(c.closed).toBe(true);
  });
});

describe("finding 4: a multi-line limit is a failure, and the tail never leaks", () => {
  test("time cap: ReplyTruncated with the partial lines, then the connection is reset", async () => {
    const server = await scriptedServer((line, _index, send) => {
      if (line === "status") {
        send("cp750.sys.input_mode analog");
        send("cp750.sys.fader 10", 50);
      } else if (line === "cp750.sys.fader 12") {
        send("cp750.sys.fader 12", 100);
      }
    });
    const c = await client(server, { commandTimeoutMs: 500, idleMs: 300, multiLineMaxMs: 30 });
    const status = c.multi("status");
    const write = c.set("cp750.sys.fader", "12");
    const error = await rejection(status);
    expect(error).toBeInstanceOf(ReplyTruncated);
    expect(error).toBeInstanceOf(Timeout);
    expect(error).toMatchObject({
      code: "TIMEOUT",
      limit: "time",
      lines: ["cp750.sys.input_mode analog"],
    });
    expect(await rejection(write)).toBeInstanceOf(NotConnected);
    expect(server.received).toEqual(["status"]);
  });

  test("line cap: ReplyTruncated, then the connection is reset before the tail arrives", async () => {
    const server = await scriptedServer((line, _index, send) => {
      if (line === "help") {
        for (let i = 1; i <= 5; i++) send(`line ${i}`);
        send("cp750.sys.fader 10", 40);
      }
    });
    const c = await client(server, { multiLineMaxLines: 3 });
    const help = c.multi("help");
    const next = c.query("cp750.sys.fader");
    const error = await rejection(help);
    expect(error).toMatchObject({ limit: "lines", lines: ["line 1", "line 2", "line 3"] });
    expect(await rejection(next)).toBeInstanceOf(NotConnected);
    expect(server.received).toEqual(["help"]);
  });

  test("a reply of exactly multiLineMaxLines lines is complete", async () => {
    const server = await scriptedServer((line, _index, send) => {
      if (line === "help") for (let i = 1; i <= 3; i++) send(`line ${i}`);
      else send("cp750.sys.fader 10");
    });
    const c = await client(server, { multiLineMaxLines: 3 });
    expect(await c.multi("help")).toEqual(["line 1", "line 2", "line 3"]);
    expect((await c.query("cp750.sys.fader")).value).toBe("10");
  });

  test("a multi-line command that never answers resets the connection after the quarantine", async () => {
    const server = await scriptedServer(() => {});
    const c = await client(server, { commandTimeoutMs: 30, quarantineMs: 60 });
    const help = c.multi("help");
    const next = c.query("cp750.sys.fader");
    expect(await rejection(help)).toBeInstanceOf(Timeout);
    expect(await rejection(next)).toBeInstanceOf(NotConnected);
    expect(server.received).toEqual(["help"]);
  });
});
