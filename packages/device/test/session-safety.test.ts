/**
 * Regression tests for review findings 1, 2 and 5–7 at the session level: injection through
 * values and raw lines, connection resets after lost sync, action echo verification, raw-read
 * policy, and the full-control tier check running atomically on the serial queue.
 */
import { describe, expect, test } from "bun:test";
import type { Manifest } from "@cp750/manifests";
import {
  Forbidden,
  InvalidValue,
  NotConnected,
  type SessionEventOf,
  Timeout,
  WriteRejected,
} from "../src/index.ts";
import { builtin, mock, rejection, session, V1, waitFor } from "./helpers.ts";

function variant(base: Manifest, change: (m: Manifest) => void): Manifest {
  const copy = structuredClone(base) as Manifest;
  change(copy);
  return copy;
}

describe("finding 1: no command injection through values or raw lines", () => {
  test("a non-ASCII character in a write value is refused before anything is sent", async () => {
    const device = await mock();
    const { session: s } = await session(device);
    const before = device.received.length;
    for (const char of ["\u010a", "\u010d", "\u0100", "\u2028", "\n", "\r", "\u0000"]) {
      const error = await rejection(
        s.write("cp750.sys.dig_1_route", `[L R C Sw Ls Rs 7 8]${char}cp750.ctrl.reboot 1`),
      );
      expect(error).toBeInstanceOf(InvalidValue);
      const raw = await rejection(s.sendRaw(`cp750.sys.fader ?${char}cp750.ctrl.reboot 1`));
      expect(raw).toBeInstanceOf(Forbidden);
      expect(raw).toMatchObject({ reason: "raw-command" });
    }
    await Bun.sleep(20);
    expect(device.received.length).toBe(before);
    expect(device.state.get("cp750.ctrl.reboot")).toBe(0);
    expect(device.connections).toBe(1);
  });
});

describe("finding 2: lost sync resets the connection; nothing is replayed", () => {
  test("a write whose reply never comes fails, queued calls fail, and the session reconnects", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 30 } });
    const { session: s, events } = await session(device, {
      timeouts: { commandMs: 40, idleMs: 20, blankGraceMs: 10, quarantineMs: 80 },
    });
    device.latencyMs = 1000;
    const slow = s.write("cp750.sys.fader", 31);
    const queued = s.write("cp750.sys.fader", 32);
    expect(await rejection(slow)).toBeInstanceOf(Timeout);
    expect(await rejection(queued)).toBeInstanceOf(NotConnected);
    device.latencyMs = 0;
    await waitFor(() =>
      events.some(
        (e) =>
          e.type === "connection" &&
          e.connection === "reconnecting" &&
          (e as SessionEventOf<"connection">).error?.message.includes("sync query") === true,
      ),
    );
    await s.connect();
    expect((await s.read("cp750.sys.fader")).value).toBe(31);
    // The timed-out write was sent once; the queued one never was.
    expect(device.received.filter((l) => l.startsWith("cp750.sys.fader 3"))).toEqual([
      "cp750.sys.fader 31",
    ]);
  });
});

describe("finding 5: actions are verified against their echo", () => {
  test("an action value the unit does not accept raises WriteRejected", async () => {
    // The unit's range for fader_delta is narrower than the manifest's.
    const unit = variant(builtin(V1), (m) => {
      const delta = m.params["cp750.ctrl.fader_delta"];
      if (delta?.value.type === "integer") delta.value.maximum = 0;
    });
    const device = await mock({ manifest: unit, initial: { "cp750.sys.fader": 70 } });
    const { session: s } = await session(device, { manifests: [builtin(V1)] });
    const error = await rejection(s.action("cp750.ctrl.fader_delta", 10));
    expect(error).toBeInstanceOf(WriteRejected);
    expect(error).toMatchObject({ requested: 10, actual: 0, param: "cp750.ctrl.fader_delta" });
    expect(device.state.get("cp750.sys.fader")).toBe(70);
  });

  test("an accepted action returns its echo, and fader_delta moves the fader", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 70 } });
    const { session: s } = await session(device);
    expect(await s.action("cp750.ctrl.fader_delta", -5)).toEqual({
      name: "cp750.ctrl.fader_delta",
      value: -5,
      raw: "-5",
    });
    expect((await s.read("cp750.sys.fader")).value).toBe(65);
  });

  test("reboot: the unit closing the connection after the command counts as accepted", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 44 } });
    const { session: s } = await session(device);
    expect(await s.action("cp750.ctrl.reboot", 1, { confirm: true })).toEqual({
      name: "cp750.ctrl.reboot",
      value: 1,
      raw: "",
    });
    await waitFor(() => s.state.connection !== "connected", { message: "reboot to drop" });
    await s.connect();
    expect((await s.read("cp750.sys.fader")).value).toBe(44);
  });

  test("other actions are not excused when the connection drops", async () => {
    const device = await mock();
    const { session: s } = await session(device);
    device.latencyMs = 50;
    const pending = s.action("cp750.ctrl.fader_delta", 1);
    await Bun.sleep(10);
    device.dropConnections();
    expect(await rejection(pending)).toBeInstanceOf(NotConnected);
  });
});

describe("finding 6: sendRaw follows the read policy", () => {
  test("tier and internal checks for known params; aggregates are filtered", async () => {
    const device = await mock();
    const { session: s } = await session(device);
    // full_ascii_ctrl is a normal-tier action: the unit now shows the full set to this session.
    await s.action("cp750.ctrl.full_ascii_ctrl", 1);
    const typed = await rejection(s.read("cp750.sys.mute"));
    expect(typed).toMatchObject({ reason: "full-tier" });
    const raw = await rejection(s.sendRaw("cp750.sys.mute ?"));
    expect(raw).toBeInstanceOf(Forbidden);
    expect(raw).toMatchObject({ reason: "full-tier", param: "cp750.sys.mute" });
    await expect(s.sendRaw("cp750.internal.save_params ?")).rejects.toMatchObject({
      reason: "internal",
    });
    for (const command of ["status", "help"]) {
      const lines = await s.sendRaw(command);
      expect(lines.some((l) => l.includes("cp750.sys.fader"))).toBe(true);
      expect(lines.filter((l) => /cp750\.internal\./i.test(l))).toEqual([]);
      expect(lines.filter((l) => l.includes("cp750.sys.mute"))).toEqual([]);
    }
    // Names the manifest does not know are still passed through (capture, debugging).
    expect(await s.sendRaw("cp750.sys.not_in_manifest ?")).toEqual([""]);
  });

  test("with allowFull and allowInternal, raw reads see everything", async () => {
    const device = await mock();
    const { session: s } = await session(device, { allowFull: true, allowInternal: true });
    expect(await s.sendRaw("cp750.sys.mute ?")).toEqual(["cp750.sys.mute 0"]);
    const status = await s.sendRaw("status");
    expect(status.some((l) => l.startsWith("cp750.internal."))).toBe(true);
    expect(status.some((l) => l.startsWith("cp750.sys.mute"))).toBe(true);
  });

  test("with allowFull, a raw full-tier read turns full control back on first", async () => {
    const device = await mock();
    const { session: s } = await session(device, { allowFull: true });
    await s.action("cp750.ctrl.full_ascii_ctrl", 0);
    expect(await s.sendRaw("cp750.sys.mute ?")).toEqual(["cp750.sys.mute 0"]);
    expect(device.received.slice(-2)).toEqual(["cp750.ctrl.full_ascii_ctrl 1", "cp750.sys.mute ?"]);
  });
});

describe("finding 7: the full-control check is atomic with the operation", () => {
  test("turning full control off concurrently with a full-tier write", async () => {
    const device = await mock();
    const { session: s } = await session(device, { allowFull: true });
    const results = await Promise.allSettled([
      s.action("cp750.ctrl.full_ascii_ctrl", 0),
      s.write("cp750.sys.mute", 1),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(device.received.slice(-3)).toEqual([
      "cp750.ctrl.full_ascii_ctrl 0",
      "cp750.ctrl.full_ascii_ctrl 1",
      "cp750.sys.mute 1",
    ]);
    expect(device.state.get("cp750.sys.mute")).toBe(1);
    expect(s.state.fullControl).toBe(true);
  });

  test("the session tracks a direct toggle of full_ascii_ctrl from the unit's echo", async () => {
    const device = await mock();
    const { session: s } = await session(device, { allowFull: true });
    expect(s.state.fullControl).toBe(true);
    await s.action("cp750.ctrl.full_ascii_ctrl", 0);
    expect(s.state.fullControl).toBe(false);
    // The next full-tier read re-enables it before the read, not after.
    expect((await s.read("cp750.sys.mute")).value).toBe(0);
    expect(s.state.fullControl).toBe(true);
    expect(device.received.slice(-2)).toEqual(["cp750.ctrl.full_ascii_ctrl 1", "cp750.sys.mute ?"]);
  });
});
