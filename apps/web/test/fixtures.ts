/** Test data shaped like the gateway's responses (`/api/device`, `/api/commands`). */
import type { Command, Device, ValueSchema } from "../src/api/types.ts";

const RANGE_0_100: ValueSchema = { type: "integer", minimum: 0, maximum: 100 };

export function command(name: string, overrides: Partial<Command> = {}): Command {
  const ns = name.split(".")[1];
  const access: Command["access"] =
    overrides.access ??
    (ns === "ctrl" ? "action" : ns === "state" || ns === "sysinfo" ? "readonly" : "readwrite");
  const operations: Command["operations"] =
    access === "action"
      ? ["read", "action"]
      : access === "readwrite"
        ? ["read", "write"]
        : ["read"];
  return {
    name,
    aliases: [],
    source: "manifest",
    availability: "confirmed",
    operations,
    blocked: {},
    access,
    tier: "normal",
    unit: null,
    destructive: false,
    internal: false,
    description: null,
    schema: RANGE_0_100,
    ...overrides,
  };
}

/** A small but representative command list (one of each control kind). */
export function fixtureCommands(): Command[] {
  return [
    command("cp750.sys.fader", { unit: "fader", description: "Main fader", aliases: ["fader"] }),
    command("cp750.sys.mute", { schema: { type: "integer", enum: [0, 1] } }),
    command("cp750.sys.input_mode", {
      schema: { type: "string", enum: ["analog", "dig_1", "dig_2", "non_sync"] },
    }),
    command("cp750.sys.mute_fade_in", {
      schema: { type: "integer", minimum: 200, maximum: 5000 },
      unit: "ms",
    }),
    command("cp750.sys.lip_sync_delay_offset", {
      schema: { type: "integer", minimum: -60, maximum: 60 },
    }),
    command("cp750.sys.hostname", { schema: { type: "string", maxLength: 16 } }),
    command("cp750.state.dig_1_present", { schema: { type: "integer", enum: [0, 1] } }),
    command("cp750.sysinfo.version", { schema: { type: "string" } }),
    command("cp750.ctrl.fader_delta", { schema: { type: "integer", minimum: -100, maximum: 100 } }),
    command("cp750.ctrl.reboot", {
      destructive: true,
      schema: { type: "integer", minimum: 0, maximum: 2147483647 },
    }),
  ];
}

export function fixtureDevice(overrides: Partial<Device> = {}): Device {
  return {
    connection: "connected",
    host: "192.168.1.136",
    port: 61408,
    firmware: "1.2.8.3",
    manifest: { firmware: "1.2.8.3", status: "verified", match: "exact", verified: true },
    fullControl: false,
    readOnly: false,
    allowFull: false,
    allowInternal: false,
    authRequired: false,
    pollMs: 1000,
    lastError: null,
    ...overrides,
  };
}
