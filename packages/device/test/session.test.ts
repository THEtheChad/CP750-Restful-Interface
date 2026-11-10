import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@cp750/manifests";
import {
  type Cp750Session,
  createCp750Session,
  Forbidden,
  NotConnected,
  type SessionEvent,
  type SessionEventOf,
  Timeout,
  UnknownParameter,
  WriteRejected,
} from "../src/index.ts";
import { startMockCp750 } from "../src/mock/index.ts";
import { builtin, mock, onCleanup, session, V1, V128, waitFor } from "./helpers.ts";

function paramEvents(events: SessionEvent[]): SessionEventOf<"param">[] {
  return events.filter((e): e is SessionEventOf<"param"> => e.type === "param");
}

function variant(base: Manifest, change: (m: Manifest) => void): Manifest {
  const copy = structuredClone(base) as Manifest;
  change(copy);
  return copy;
}

async function rawSockets(device: { host: string; port: number }, count: number) {
  const sockets = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<Socket>((resolve, reject) => {
          const socket = connect(device.port, device.host, () => resolve(socket));
          socket.on("error", reject);
        }),
    ),
  );
  onCleanup(() => {
    for (const socket of sockets) socket.destroy();
  });
  return sockets;
}

describe("session: reads and writes", () => {
  test("query/set round trip, aliases, and param events only on change", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 70 } });
    const { session: s, events } = await session(device);
    expect(s.state).toMatchObject({ connection: "connected", firmware: V1, fullControl: false });
    expect(await s.read("CP750.SYS.FADER")).toEqual({
      name: "cp750.sys.fader",
      value: 70,
      raw: "70",
    });
    expect((await s.read("version")).value).toBe(V1);
    expect(await s.write("cp750.sys.fader", 55)).toEqual({
      name: "cp750.sys.fader",
      value: 55,
      raw: "55",
    });
    await s.read("cp750.sys.fader");
    expect(await s.write("cp750.sys.input_mode", "dig_1")).toMatchObject({ value: "dig_1" });
    expect(paramEvents(events).map((e) => [e.name, e.previous, e.value])).toEqual([
      ["cp750.sys.fader", undefined, 70],
      ["cp750.sysinfo.version", undefined, V1],
      ["cp750.sys.fader", 70, 55],
      ["cp750.sys.input_mode", undefined, "dig_1"],
    ]);
  });

  test("a write the unit ignores raises WriteRejected with the actual value", async () => {
    // The unit's real range is narrower than the manifest says: it ignores 95 and echoes 40.
    const unit = variant(builtin(V1), (m) => {
      const fader = m.params["cp750.sys.fader"];
      if (fader?.value.type === "integer") fader.value.maximum = 90;
    });
    const device = await mock({ manifest: unit, initial: { "cp750.sys.fader": 40 } });
    const { session: s, events } = await session(device);
    const error = await s.write("cp750.sys.fader", 95).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteRejected);
    expect(error).toMatchObject({ requested: 95, actual: 40, raw: "40", param: "cp750.sys.fader" });
    expect(paramEvents(events).at(-1)).toMatchObject({ name: "cp750.sys.fader", value: 40 });
  });

  test("schema violations are refused before anything is sent", async () => {
    const device = await mock();
    const { session: s } = await session(device);
    const before = device.received.length;
    await expect(s.write("cp750.sys.fader", 101)).rejects.toMatchObject({ code: "INVALID_VALUE" });
    await expect(s.write("cp750.sys.input_mode", "bogus")).rejects.toMatchObject({
      code: "INVALID_VALUE",
    });
    await Bun.sleep(10);
    expect(device.received.length).toBe(before);
  });

  test("unknown params: not in the manifest, missing from help, or a blank reply", async () => {
    const unit = variant(builtin(V1), (m) => {
      delete m.params["cp750.sys.input_mode"];
    });
    const device = await mock({ manifest: unit });
    const { session: s } = await session(device);
    await expect(s.read("cp750.sys.nope")).rejects.toBeInstanceOf(UnknownParameter);
    // The manifest has input_mode, but this unit's help does not list it.
    await expect(s.read("cp750.sys.input_mode")).rejects.toBeInstanceOf(UnknownParameter);
    expect(s.commands().find((c) => c.name === "cp750.sys.input_mode")?.availability).toBe(
      "missing",
    );
    expect(await s.sendRaw("cp750.sys.input_mode ?")).toEqual([""]);
    expect(await s.sendRaw("CP750.SYS.FADER ?")).toEqual(["cp750.sys.fader 0"]);
  });

  test("timeout, then the session and its queue keep working", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 30 } });
    const { session: s } = await session(device, {
      timeouts: { commandMs: 60, idleMs: 20, blankGraceMs: 10 },
    });
    device.latencyMs = 100;
    const slow = s.write("cp750.sys.fader", 31).catch((e: unknown) => e);
    const queued = s.write("cp750.sys.fader", 32);
    expect(await slow).toBeInstanceOf(Timeout);
    device.latencyMs = 0;
    expect((await queued).value).toBe(32);
    expect((await s.read("cp750.sys.fader")).value).toBe(32);
    expect(s.state.connection).toBe("connected");
  });

  test("50 concurrent reads and writes (with polling) each get their own reply", async () => {
    const device = await mock({ latencyMs: 1 });
    const { session: s } = await session(device, {
      pollIntervalMs: 2,
      pollParams: ["cp750.sys.fader", "cp750.sys.input_mode"],
    });
    const modes = ["analog", "dig_1", "dig_2", "dig_3"];
    const calls: Promise<{ value: unknown }>[] = [];
    const expected: unknown[] = [];
    let fader = 0;
    let mode = "analog";
    for (let i = 0; i < 50; i++) {
      if (i % 4 === 0) {
        fader = i;
        calls.push(s.write("cp750.sys.fader", i));
        expected.push(i);
      } else if (i % 4 === 1) {
        calls.push(s.read("cp750.sys.fader"));
        expected.push(fader);
      } else if (i % 4 === 2) {
        mode = modes[i % modes.length] ?? "analog";
        calls.push(s.write("cp750.sys.input_mode", mode));
        expected.push(mode);
      } else {
        calls.push(s.read("cp750.sys.input_mode"));
        expected.push(mode);
      }
    }
    const results = await Promise.all(calls);
    expect(results.map((r) => r.value)).toEqual(expected);
  });
});

describe("session: firmware detection", () => {
  async function detect(manifest: Manifest, initial?: Record<string, string>) {
    const device = await mock({ manifest, ...(initial && { initial }) });
    const { session: s, events } = await session(device);
    return { s, events };
  }

  test("exact verified", async () => {
    const { s, events } = await detect(builtin(V1));
    expect(s.state.manifest).toEqual({
      firmware: V1,
      status: "verified",
      match: "exact",
      verified: true,
    });
    const types = events.map((e) => e.type);
    expect(types.indexOf("device")).toBeLessThan(types.lastIndexOf("connection"));
    expect(events.at(-1)).toMatchObject({ type: "connection", connection: "connected" });
  });

  test("exact draft", async () => {
    const { s } = await detect(builtin(V128));
    expect(s.state.manifest).toEqual({
      firmware: V128,
      status: "draft",
      match: "exact",
      verified: false,
    });
    // Unverified, but help confirms fader, so writes are allowed.
    expect((await s.write("cp750.sys.fader", 12)).value).toBe(12);
  });

  test("nearest lower firmware", async () => {
    const { s } = await detect(builtin(V1), { "cp750.sysinfo.version": "1.1.0.0" });
    expect(s.state.firmware).toBe("1.1.0.0");
    expect(s.state.manifest).toEqual({
      firmware: V1,
      status: "verified",
      match: "nearest",
      verified: false,
    });
    expect((await s.write("cp750.sys.fader", 13)).value).toBe(13);
  });

  test("none: raw reads only", async () => {
    const { s } = await detect(builtin(V1), { "cp750.sysinfo.version": "0.9" });
    expect(s.state.firmware).toBe("0.9");
    expect(s.state.manifest).toEqual({
      firmware: null,
      status: null,
      match: "none",
      verified: false,
    });
    expect(await s.read("cp750.sys.fader")).toEqual({
      name: "cp750.sys.fader",
      value: "0",
      raw: "0",
    });
    const error = await s.write("cp750.sys.fader", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Forbidden);
    expect(error).toMatchObject({ reason: "raw-only" });
  });

  test("manifests from manifestDir are used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp750-manifests-"));
    const extra = variant(builtin(V1), (m) => {
      m.firmware = "1.1.0.0";
      m.status = "draft";
      delete m.$schema;
    });
    await writeFile(join(dir, "1.1.0.0.json"), JSON.stringify(extra));
    const device = await mock({ manifest: extra });
    const { session: s } = await session(device, { manifestDir: dir });
    expect(s.state.manifest).toMatchObject({ firmware: "1.1.0.0", match: "exact" });
  });

  test("reconnects after the unit restarts and detects the firmware again", async () => {
    const first = await startMockCp750({ manifest: builtin(V1) });
    const { port, host } = first;
    const { session: s, events } = await session(first);
    expect(s.state.firmware).toBe(V1);

    await first.close();
    await waitFor(() => s.state.connection === "reconnecting", { message: "reconnecting" });
    await expect(s.read("cp750.sys.fader")).rejects.toBeInstanceOf(NotConnected);

    const second = await startMockCp750({ manifest: builtin(V128), port, host });
    onCleanup(() => second.close());
    await s.connect();
    expect(s.state.firmware).toBe(V128);
    expect(s.state.manifest).toMatchObject({ firmware: V128, match: "exact" });
    expect(events.filter((e) => e.type === "device").map((e) => e.firmware)).toEqual([V1, V128]);
    expect((await s.read("cp750.sys.fader")).value).toBe(0);
    expect(s.state.lastError).toBeNull();
  });

  test("retries with backoff until the unit appears", async () => {
    const probe = await startMockCp750({ manifest: builtin(V1) });
    const { port, host } = probe;
    await probe.close();
    const { session: s, events } = await session({ port, host }, {}, { connect: false });
    const ready = s.connect();
    await waitFor(
      () => events.filter((e) => e.type === "connection" && e.error !== null).length >= 2,
      { message: "two failed attempts" },
    );
    expect(s.state.lastError?.code).toBe("CONNECTION");
    const device = await startMockCp750({ manifest: builtin(V1), port, host });
    onCleanup(() => device.close());
    await ready;
    expect(s.state.connection).toBe("connected");
  });
});

describe("session: full command set", () => {
  test("allowFull off: full-tier params are Forbidden", async () => {
    const device = await mock();
    const { session: s } = await session(device);
    const error = await s.read("cp750.sys.mute").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Forbidden);
    expect(error).toMatchObject({ reason: "full-tier" });
    const mute = s.commands().find((c) => c.name === "cp750.sys.mute");
    expect(mute).toMatchObject({ availability: "unchecked", operations: [] });
    expect(mute?.blocked.read).toBe("full-tier");
    expect(device.received).not.toContain("cp750.ctrl.full_ascii_ctrl 1");
  });

  test("allowFull on: enables full_ascii_ctrl, succeeds, and re-asserts after a reconnect", async () => {
    const device = await mock();
    const { session: s } = await session(device, { allowFull: true });
    expect(s.state.fullControl).toBe(true);
    expect((await s.read("cp750.sys.mute")).value).toBe(0);
    expect((await s.write("cp750.sys.mute", 1)).value).toBe(1);
    expect(s.commands().find((c) => c.name === "cp750.sys.mute")?.availability).toBe("confirmed");

    // The unit forgets full control with the session; the client re-enables it lazily too.
    await s.action("cp750.ctrl.full_ascii_ctrl", 0);
    expect(s.state.fullControl).toBe(false);
    expect((await s.read("cp750.sys.mute")).value).toBe(1);
    expect(s.state.fullControl).toBe(true);

    device.dropConnections();
    await waitFor(() => s.state.connection !== "connected", { message: "drop" });
    await s.connect();
    expect(s.state.fullControl).toBe(true);
    expect((await s.read("cp750.sys.mute")).value).toBe(1);
    const enables = device.received.filter((l) => l === "cp750.ctrl.full_ascii_ctrl 1");
    expect(enables.length).toBe(3);
  });
});

describe("session: polling", () => {
  test("skips forbidden mute (logged once) and emits events only on change", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 70 } });
    const { session: s, events, logger } = await session(device, { pollIntervalMs: 10 });
    await waitFor(() => paramEvents(events).length >= 2, { message: "initial poll" });
    expect(
      paramEvents(events)
        .map((e) => e.name)
        .sort(),
    ).toEqual(["cp750.sys.fader", "cp750.sys.input_mode"]);

    device.state.set("cp750.sys.fader", 55);
    await waitFor(() => paramEvents(events).length >= 3, { message: "fader change" });
    expect(paramEvents(events)[2]).toMatchObject({
      name: "cp750.sys.fader",
      previous: 70,
      value: 55,
      raw: "55",
    });
    await Bun.sleep(60);
    expect(paramEvents(events).length).toBe(3);
    expect(device.received.some((l) => l.startsWith("cp750.sys.mute"))).toBe(false);
    expect(logger.warnings.filter((w) => w.includes("cp750.sys.mute"))).toEqual([
      "Not polling cp750.sys.mute: full-tier",
    ]);
    expect(s.state.connection).toBe("connected");
  });

  test("polls mute when it is normal tier (1.2.8.3) and survives failed polls", async () => {
    const device = await mock({ manifest: builtin(V128) });
    const { session: s, events } = await session(device, {
      pollIntervalMs: 5,
      timeouts: { commandMs: 30, idleMs: 20, blankGraceMs: 10 },
    });
    await waitFor(() => paramEvents(events).some((e) => e.name === "cp750.sys.mute"));
    device.latencyMs = 50;
    await Bun.sleep(150);
    device.latencyMs = 0;
    device.state.set("cp750.sys.mute", 1);
    await waitFor(() =>
      paramEvents(events).some((e) => e.name === "cp750.sys.mute" && e.value === 1),
    );
    expect(s.state.connection).toBe("connected");
  });
});

describe("session: access and lifecycle", () => {
  test("read-only mode, destructive confirmation, sendRaw restrictions", async () => {
    const device = await mock();
    const ro = (await session(device, { readOnly: true })).session;
    await expect(ro.write("cp750.sys.fader", 1)).rejects.toMatchObject({
      reason: "read-only-mode",
    });

    const { session: s } = await session(device);
    await expect(s.action("cp750.ctrl.reboot")).rejects.toMatchObject({
      reason: "confirmation-required",
    });
    // The mock's reboot ends the session without a reply; that counts as accepted.
    expect(await s.action("cp750.ctrl.reboot", undefined, { confirm: true })).toEqual({
      name: "cp750.ctrl.reboot",
      value: 1,
      raw: "",
    });
    await waitFor(() => s.state.connection !== "connected", { message: "reboot to drop" });
    await s.connect();
    await expect(s.sendRaw("cp750.sys.fader 5")).rejects.toMatchObject({ reason: "raw-command" });
    await expect(s.sendRaw("cp750.internal.save_params ?")).rejects.toMatchObject({
      reason: "internal",
    });
    const status = await s.sendRaw("status");
    expect(status).toContain("cp750.sys.fader : 0");
  });

  test("the 21st-session warning is ignored; the session reconnects", async () => {
    const device = await mock({ evictionDelayMs: 30 });
    const { session: s, logger } = await session(device);
    await rawSockets(device, 20);
    await waitFor(() => s.state.connection !== "connected", { message: "eviction" });
    await s.connect();
    expect((await s.read("cp750.sys.fader")).value).toBe(0);
    expect(logger.warnings).toEqual([]);
  });

  test("close sends exit, stops reconnecting, and rejects further calls", async () => {
    const device = await mock();
    const { session: s, events } = await session(device);
    await s.close();
    await s.close();
    await waitFor(() => device.connections === 0, { message: "mock to see the close" });
    expect(device.received.at(-1)).toBe("exit");
    expect(s.state.connection).toBe("closed");
    expect(events.at(-1)).toMatchObject({ type: "connection", connection: "closed" });
    await expect(s.read("cp750.sys.fader")).rejects.toBeInstanceOf(NotConnected);
    await expect(s.connect()).rejects.toBeInstanceOf(NotConnected);
    await Bun.sleep(50);
    expect(device.connections).toBe(0);
  });

  test("close while still connecting rejects the connect promise", async () => {
    const probe = await startMockCp750({ manifest: builtin(V1) });
    const { port, host } = probe;
    await probe.close();
    const { session: s } = await session({ port, host }, {}, { connect: false });
    const ready = s.connect().catch((e: unknown) => e);
    await Bun.sleep(30);
    await s.close();
    expect(await ready).toBeInstanceOf(NotConnected);
  });

  test("commands() is empty before detection", () => {
    const s: Cp750Session = createCp750Session({ host: "127.0.0.1", port: 1 });
    expect(s.commands()).toEqual([]);
    expect(s.state).toMatchObject({ connection: "idle", firmware: null, manifest: null });
  });
});
