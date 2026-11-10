import { describe, expect, test } from "bun:test";
import {
  Cp750Client,
  LineSplitter,
  parseReplyLine,
  Timeout,
  UnknownParameter,
} from "../src/index.ts";
import { EVICTION_WARNING } from "../src/mock/index.ts";
import { mock, onCleanup, waitFor } from "./helpers.ts";

async function client(
  device: { host: string; port: number },
  options: Partial<Parameters<typeof Cp750Client.connect>[0]> = {},
) {
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

describe("LineSplitter", () => {
  test("splits on CR, LF and CRLF (even across chunks) and strips NULs", () => {
    const s = new LineSplitter();
    expect(s.push("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(s.push("d\r")).toEqual(["d"]);
    expect(s.push("\ne\u0000f\n\n")).toEqual(["ef", ""]);
    expect(s.push("tail")).toEqual([]);
    expect(s.flush()).toBe("tail");
  });

  test("parseReplyLine handles both reply forms", () => {
    expect(parseReplyLine("CP750.SYS.FADER  70 ")).toEqual({ key: "cp750.sys.fader", value: "70" });
    expect(parseReplyLine("cp750.sys.fader : 70")).toEqual({
      key: "cp750.sys.fader",
      value: "70",
    });
    expect(parseReplyLine("cp750.sys.mac")).toEqual({ key: "cp750.sys.mac", value: "" });
    expect(parseReplyLine("  ")).toBeNull();
  });
});

describe("Cp750Client against the mock", () => {
  test("query/set round trip, case-insensitive and whitespace-tolerant", async () => {
    const device = await mock();
    const c = await client(device);
    expect((await c.query("cp750.sys.fader")).value).toBe("0");
    expect((await c.set("CP750.SYS.FADER", "55")).value).toBe("55");
    expect(device.state.get("cp750.sys.fader")).toBe(55);
    expect(await c.query("cp750.sys.input_mode")).toEqual({
      key: "cp750.sys.input_mode",
      value: "analog",
      line: "cp750.sys.input_mode analog",
    });
  });

  test("an invalid value is ignored and the current value echoed", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 40 } });
    const c = await client(device);
    expect((await c.set("cp750.sys.fader", "101")).value).toBe("40");
    expect((await c.set("cp750.sys.input_mode", "bogus")).value).toBe("analog");
  });

  test("an unknown param gets a blank line → UnknownParameter", async () => {
    const device = await mock();
    const c = await client(device);
    await expect(c.query("cp750.sys.nope")).rejects.toBeInstanceOf(UnknownParameter);
    // Full-tier params are unknown until full_ascii_ctrl is 1 (per connection).
    await expect(c.query("cp750.sys.mute")).rejects.toBeInstanceOf(UnknownParameter);
    expect((await c.set("cp750.ctrl.full_ascii_ctrl", "1")).value).toBe("1");
    expect((await c.query("cp750.sys.mute")).value).toBe("0");
    const other = await client(device);
    await expect(other.query("cp750.sys.mute")).rejects.toBeInstanceOf(UnknownParameter);
  });

  test("timeout, then the queue keeps working (late reply is not misattributed)", async () => {
    const device = await mock({ latencyMs: 120, initial: { "cp750.sys.fader": 10 } });
    const c = await client(device, { commandTimeoutMs: 50 });
    const first = c.set("cp750.sys.fader", "20");
    const second = c.query("cp750.sys.fader");
    const error = await first.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Timeout);
    device.latencyMs = 0;
    expect((await second).value).toBe("20");
    expect((await c.set("cp750.sys.fader", "30")).value).toBe("30");
    expect((await c.query("cp750.sys.input_mode")).value).toBe("analog");
  });

  test("timeout quarantine keeps a late echo from failing the next write", async () => {
    const device = await mock({ latencyMs: 100 });
    const c = await client(device, { commandTimeoutMs: 40 });
    const late = c.set("cp750.sys.fader", "11").catch((e: unknown) => e);
    const next = c.set("cp750.sys.fader", "12");
    expect(await late).toBeInstanceOf(Timeout);
    device.latencyMs = 0;
    expect((await next).value).toBe("12");
  });

  test("tolerates NUL bytes and replies fragmented across TCP chunks", async () => {
    const device = await mock({ nulBytes: true, fragmented: true });
    const c = await client(device);
    expect((await c.set("cp750.sys.fader", "70")).line).toBe("cp750.sys.fader 70");
    await expect(c.query("cp750.sys.nope")).rejects.toBeInstanceOf(UnknownParameter);
    const status = await c.multi("status");
    expect(status).toContain("cp750.sys.fader : 70");
    expect(status.join("")).not.toContain("\u0000");
  });

  test("stray blank lines before a reply are absorbed by the grace window", async () => {
    const device = await mock({ blankForEmptyLines: true });
    const c = await client(device, { blankGraceMs: 30 });
    for (let i = 0; i < 20; i++) {
      expect((await c.set("cp750.sys.fader", String(i))).value).toBe(String(i));
    }
    await expect(c.query("cp750.sys.nope")).rejects.toBeInstanceOf(UnknownParameter);
    expect((await c.query("cp750.sys.fader")).value).toBe("19");
  });

  test("multi-line help ends on the idle gap", async () => {
    const device = await mock();
    const c = await client(device);
    const help = await c.multi("help");
    expect(help.some((l) => l.includes("cp750.sys.fader"))).toBe(true);
    expect(help.some((l) => l.includes("cp750.sys.mute"))).toBe(false);
    expect((await c.query("cp750.sys.fader")).value).toBe("0");
  });

  test("the 21st session kicks the oldest; its warning is ignored mid-request", async () => {
    const device = await mock({ latencyMs: 40, evictionDelayMs: 150 });
    const unsolicited: string[] = [];
    const c = await client(device, { onUnsolicited: (l) => unsolicited.push(l) });
    const pending = c.query("cp750.sys.input_mode");
    const others = await Promise.all(Array.from({ length: 20 }, () => client(device)));
    expect(others.length).toBe(20);
    expect((await pending).value).toBe("analog");
    expect(unsolicited).toEqual([EVICTION_WARNING]);
    await c.done;
    expect(device.connections).toBe(20);
  });

  test("close sends exit", async () => {
    const device = await mock();
    const c = await client(device);
    await c.query("cp750.sys.fader");
    await c.close();
    await waitFor(() => device.connections === 0, { message: "mock to drop the session" });
    expect(device.received.at(-1)).toBe("exit");
  });
});
