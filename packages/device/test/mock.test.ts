import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { assertManifest, type Manifest } from "@cp750/manifests";
import { buildDraftManifest, Cp750Client, captureDevice } from "../src/index.ts";
import { mockDefaultValue } from "../src/mock/index.ts";
import { builtin, mock, onCleanup, V1, V128, waitFor } from "./helpers.ts";

/** Sends raw text and collects everything the mock writes back until it goes quiet. */
async function converse(device: { host: string; port: number }, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = connect(device.port, device.host, () => socket.write(text));
    socket.setEncoding("latin1");
    const finish = () => {
      socket.destroy();
      resolve(out);
    };
    socket.on("data", (chunk: string) => {
      out += chunk;
      clearTimeout(timer);
      timer = setTimeout(finish, 30);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
    socket.on("error", reject);
  });
}

describe("mock CP750", () => {
  test("defaults follow the value schema", () => {
    expect(mockDefaultValue({ type: "integer", minimum: 0, maximum: 100 })).toBe(0);
    expect(mockDefaultValue({ type: "integer", minimum: -900, maximum: 100 })).toBe(0);
    expect(mockDefaultValue({ type: "integer", minimum: 200, maximum: 5000 })).toBe(200);
    expect(mockDefaultValue({ type: "string", enum: ["b", "a"] })).toBe("b");
    expect(mockDefaultValue({ type: "string" })).toBe("");
  });

  test("case-insensitive commands, ignored whitespace, LF or CR terminators", async () => {
    const device = await mock();
    const reply = await converse(device, "  CP750.SYS.FADER    42  \n\rcp750.sys.fader ?\r");
    expect(reply).toBe("cp750.sys.fader 42\r\ncp750.sys.fader 42\r\n");
    expect(await converse(device, "Cp750.Sys.Input_Mode DIG_1\n")).toBe(
      "cp750.sys.input_mode dig_1\r\n",
    );
  });

  test("unknown params and full-tier params without full control get a blank line", async () => {
    const device = await mock();
    expect(await converse(device, "cp750.sys.nope ?\r\n")).toBe("\r\n");
    expect(await converse(device, "cp750.sys.mute ?\r\n")).toBe("\r\n");
    expect(await converse(device, "cp750.ctrl.full_ascii_ctrl 1\r\ncp750.sys.mute ?\r\n")).toBe(
      "cp750.ctrl.full_ascii_ctrl 1\r\ncp750.sys.mute 0\r\n",
    );
  });

  test("status uses `param : value` lines followed by a blank line", async () => {
    const device = await mock();
    const reply = await converse(device, "status\r\n");
    expect(reply).toContain(`cp750.sysinfo.version : ${V1}\r\n`);
    expect(reply).toContain("cp750.sys.fader : 0\r\n");
    expect(reply).not.toContain("cp750.sys.mute");
    expect(reply.endsWith("\r\n\r\n")).toBe(true);
  });

  test("exit closes the connection", async () => {
    const device = await mock();
    const reply = await converse(device, "EXIT\r\n");
    expect(reply).toBe("");
    await waitFor(() => device.connections === 0);
  });
});

describe("captureDevice", () => {
  test("produces a valid draft manifest merged from the nearest built-in", async () => {
    // A unit with firmware we do not ship, a param no built-in has, and a full-only extra.
    const unit = structuredClone(builtin(V1)) as Manifest;
    unit.firmware = "1.2.9.0";
    unit.params["cp750.sys.mystery"] = {
      tier: "normal",
      access: "readwrite",
      accessSource: "inferred",
      value: { type: "integer" },
    };
    unit.params["cp750.diag.secret_full"] = {
      tier: "full",
      access: "readonly",
      accessSource: "inferred",
      value: { type: "string" },
    };
    const device = await mock({ manifest: unit });
    const result = await captureDevice({
      host: device.host,
      port: device.port,
      timeoutMs: 500,
      idleMs: 20,
    });

    expect(result.firmware).toBe("1.2.9.0");
    expect(result.versionLine).toBe("cp750.sysinfo.version 1.2.9.0");
    expect(result.base).toEqual({ firmware: V128, match: "nearest" });
    expect(result.help.some((l) => l.includes("cp750.sys.fader"))).toBe(true);
    expect(result.status).toContain("cp750.sys.fader : 0");
    expect(result.helpFull?.some((l) => l.includes("cp750.diag.secret_full"))).toBe(true);

    const draft = assertManifest(result.draftManifest);
    expect(draft.status).toBe("draft");
    expect(draft.firmware).toBe("1.2.9.0");
    expect(draft.sources[0]?.kind).toBe("capture");
    expect(draft.commands).toEqual(["help", "status", "dump_log", "dump_log_100", "exit"]);
    expect(draft.params["cp750.sys.fader"]).toEqual(builtin(V128).params["cp750.sys.fader"]);
    expect(draft.params["cp750.sys.mystery"]).toMatchObject({
      tier: "normal",
      access: "readonly",
      accessSource: "observed",
      value: { type: "string" },
    });
    expect(draft.params["cp750.diag.secret_full"]).toMatchObject({
      tier: "full",
      accessSource: "observed",
    });
    // Observed tiers override the base: this unit only shows mute with full control.
    expect(draft.params["cp750.sys.mute"]?.tier).toBe("full");
    // Params the unit did not show are left out.
    expect(Object.keys(draft.params).length).toBe(Object.keys(unit.params).length);

    // Capture leaves the unit as it found it, and says goodbye.
    expect(device.received.slice(-2)).toEqual(["cp750.ctrl.full_ascii_ctrl 0", "exit"]);
  });

  test("without a full-set capture, base tiers are kept and unknown names are normal", () => {
    const { manifest, base } = buildDraftManifest({
      firmware: "0.5",
      help: ["cp750.sys.fader", "cp750.internal.thing"],
      status: ["cp750.sys.mute : 0"],
      helpFull: null,
      statusFull: null,
      manifests: [builtin(V1), builtin(V128)],
      ref: "test",
    });
    expect(base).toEqual({ firmware: V1, match: "none" });
    expect(manifest.params["cp750.sys.mute"]?.tier).toBe("full");
    expect(manifest.params["cp750.internal.thing"]).toMatchObject({
      internal: true,
      tier: "normal",
    });
    expect(manifest.commands).toEqual(["help", "status", "exit"]);
  });
});

describe("mock CP750 actions (finding 8)", () => {
  async function client(device: { host: string; port: number }) {
    const c = await Cp750Client.connect({ host: device.host, port: device.port, idleMs: 20 });
    onCleanup(() => c.close());
    return c;
  }

  test("fader_delta moves the fader, clamped to 0–100, and echoes the delta", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 70 } });
    const c = await client(device);
    expect((await c.set("cp750.ctrl.fader_delta", "10")).value).toBe("10");
    expect((await c.query("cp750.sys.fader")).value).toBe("80");
    await c.set("cp750.ctrl.fader_delta", "50");
    expect(device.state.get("cp750.sys.fader")).toBe(100);
    await c.set("cp750.ctrl.fader_delta", "-100");
    await c.set("cp750.ctrl.fader_delta", "-3");
    expect(device.state.get("cp750.sys.fader")).toBe(0);
    // Out of range: ignored, and the echo is the last accepted delta.
    expect((await c.set("cp750.ctrl.fader_delta", "500")).value).toBe("-3");
    expect(device.state.get("cp750.sys.fader")).toBe(0);
  });

  test("reboot closes every session without a reply and keeps the values", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 42 } });
    const first = await client(device);
    const second = await client(device);
    const reboot = first.set("cp750.ctrl.reboot", "1").catch((e: unknown) => e);
    expect(await reboot).toMatchObject({ code: "NOT_CONNECTED", inFlight: true });
    await first.done;
    await second.done;
    expect(device.connections).toBe(0);
    const after = await client(device);
    expect((await after.query("cp750.sys.fader")).value).toBe("42");
  });

  test("other actions are echoed no-ops", async () => {
    const device = await mock({ initial: { "cp750.sys.fader": 42 } });
    const c = await client(device);
    expect((await c.set("cp750.ctrl.log_erase", "1")).value).toBe("1");
    expect((await c.set("cp750.ctrl.default_params", "1")).value).toBe("1");
    expect(device.state.get("cp750.sys.fader")).toBe(42);
  });
});
