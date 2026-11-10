import { describe, expect, test } from "bun:test";
import { builtinManifests } from "@cp750/manifests";
import {
  type Cp750Error,
  Forbidden,
  InvalidValue,
  NotConnected,
  type SessionEvent,
  UnknownParameter,
  WriteRejected,
} from "../src/index.ts";
import { FakeSession } from "../src/testing/index.ts";

async function connected(options: ConstructorParameters<typeof FakeSession>[0] = {}) {
  const session = new FakeSession(options);
  await session.connect();
  return session;
}

async function rejection(promise: Promise<unknown>): Promise<Cp750Error> {
  try {
    await promise;
  } catch (error) {
    return error as Cp750Error;
  }
  throw new Error("expected a rejection");
}

const draft = builtinManifests().find((m) => m.status === "draft");

describe("FakeSession", () => {
  test("reports state and emits connection and device events", async () => {
    const session = new FakeSession();
    const events: SessionEvent["type"][] = [];
    session.subscribe((e) => events.push(e.type));
    expect(session.state.connection).toBe("idle");
    expect(session.commands()).toEqual([]);
    await session.connect();
    expect(events).toEqual(["connection", "connection", "device"]);
    expect(session.state).toMatchObject({
      connection: "connected",
      port: 61408,
      firmware: "1.0.0.150183",
      manifest: { firmware: "1.0.0.150183", status: "verified", match: "exact", verified: true },
      fullControl: false,
    });
    await session.close();
    expect(await rejection(session.read("version"))).toBeInstanceOf(NotConnected);
  });

  test("reads by alias and writes with an echo check", async () => {
    const session = await connected();
    expect(await session.read("VERSION")).toEqual({
      name: "cp750.sysinfo.version",
      value: "",
      raw: "",
    });
    const params: SessionEvent[] = [];
    session.on("param", (e) => params.push(e));
    expect(await session.write("cp750.sys.input_mode", "dig_1")).toEqual({
      name: "cp750.sys.input_mode",
      value: "dig_1",
      raw: "dig_1",
    });
    expect(params).toHaveLength(1);
    expect(session.sent).toContain("cp750.sys.input_mode dig_1");
  });

  test("raises typed errors with stable codes", async () => {
    const session = await connected();
    const unknown = await rejection(session.read("cp750.sys.nope"));
    expect(unknown).toBeInstanceOf(UnknownParameter);
    expect(unknown.code).toBe("UNKNOWN_PARAMETER");

    const invalid = await rejection(session.write("cp750.sys.fader", 101));
    expect(invalid).toBeInstanceOf(InvalidValue);
    expect(invalid.code).toBe("INVALID_VALUE");

    const readonly = await rejection(session.write("cp750.sysinfo.version", "2"));
    expect(readonly).toMatchObject({ code: "FORBIDDEN", reason: "access" });

    session.rejectWrites("cp750.sys.fader");
    const rejected = await rejection(session.write("cp750.sys.fader", 40));
    expect(rejected).toBeInstanceOf(WriteRejected);
    expect(rejected).toMatchObject({ code: "WRITE_REJECTED", requested: 40, actual: 70 });
  });

  test("blocks full-tier and internal params unless allowed", async () => {
    const session = await connected();
    expect(await rejection(session.read("cp750.sys.mute"))).toMatchObject({ reason: "full-tier" });
    expect(session.commands().some((c) => c.name.startsWith("cp750.internal."))).toBe(false);

    const full = await connected({ allowFull: true, allowInternal: true });
    expect(full.state.fullControl).toBe(true);
    expect(full.sent).toContain("cp750.ctrl.full_ascii_ctrl 1");
    expect((await full.write("cp750.sys.mute", 1)).value).toBe(1);
    expect(full.commands().some((c) => c.name === "cp750.internal.save_params")).toBe(true);
  });

  test("destructive actions need confirmation", async () => {
    const session = await connected();
    expect(await rejection(session.action("cp750.ctrl.reboot"))).toMatchObject({
      reason: "confirmation-required",
    });
    expect((await session.action("cp750.ctrl.reboot", undefined, { confirm: true })).value).toBe(1);
    expect(await rejection(session.action("cp750.sys.fader", 1))).toMatchObject({
      reason: "access",
    });
  });

  test("read-only mode refuses writes and actions but allows reads", async () => {
    const session = await connected({ readOnly: true });
    expect(await rejection(session.write("cp750.sys.input_mode", "dig_1"))).toMatchObject({
      reason: "read-only-mode",
    });
    expect((await session.read("cp750.sys.fader")).value).toBe(70);
    const fader = session.commands().find((c) => c.name === "cp750.sys.fader");
    expect(fader?.operations).toEqual(["read"]);
    expect(fader?.blocked).toEqual({ write: "read-only-mode" });
  });

  test("unverified manifests only allow writes to help-confirmed params", async () => {
    const session = await connected({
      manifest: draft ?? null,
      helpNames: ["cp750.sys.fader", "cp750.sysinfo.version", "cp750.sys.brand_new"],
    });
    expect(session.state.manifest).toMatchObject({ match: "exact", verified: false });
    expect((await session.write("cp750.sys.fader", 50)).value).toBe(50);
    expect(await rejection(session.write("cp750.sys.input_mode", "dig_1"))).toBeInstanceOf(
      UnknownParameter,
    );
    const helpOnly = session.commands().find((c) => c.name === "cp750.sys.brand_new");
    expect(helpOnly).toMatchObject({ source: "help", spec: null, operations: ["read"] });
    expect(await rejection(session.write("cp750.sys.brand_new", "x"))).toMatchObject({
      reason: "raw-only",
    });

    const unchecked = await connected({ manifest: draft ?? null });
    expect(await rejection(unchecked.write("cp750.sys.fader", 50))).toMatchObject({
      reason: "unverified",
    });
  });

  test("nearest and none matches", async () => {
    const nearest = await connected({ firmware: "1.1.0" });
    expect(nearest.state.manifest).toMatchObject({ match: "nearest", verified: false });

    const none = await connected({ manifest: null, firmware: "9.9" });
    expect(none.state.manifest).toEqual({
      firmware: null,
      status: null,
      match: "none",
      verified: false,
    });
    none.setDeviceValue("cp750.sys.fader", "70");
    expect(await none.read("cp750.sys.fader")).toEqual({
      name: "cp750.sys.fader",
      value: "70",
      raw: "70",
    });
    expect(await rejection(none.write("cp750.sys.fader", 70))).toMatchObject({
      reason: "raw-only",
    });
  });

  test("sendRaw only sends read-only lines", async () => {
    const session = await connected();
    expect(await session.sendRaw("cp750.sys.fader ?")).toEqual(["cp750.sys.fader 70"]);
    expect(await session.sendRaw("cp750.sys.nope ?")).toEqual([""]);
    expect((await session.sendRaw("HELP")).length).toBeGreaterThan(0);
    for (const line of ["cp750.sys.fader 10", "exit", "cp750.sys.fader ?\ncp750.ctrl.reboot 1"]) {
      const error = await rejection(session.sendRaw(line));
      expect(error).toBeInstanceOf(Forbidden);
      expect(error).toMatchObject({ reason: "raw-command" });
    }
  });

  test("disconnect emits a connection event with the error", async () => {
    const session = await connected();
    const events: SessionEvent[] = [];
    session.on("connection", (e) => events.push(e));
    session.disconnect("cable pulled");
    expect(events[0]).toMatchObject({
      connection: "reconnecting",
      error: { code: "CONNECTION", message: "cable pulled" },
    });
    expect(await rejection(session.read("version"))).toBeInstanceOf(NotConnected);
  });
});
