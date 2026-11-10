import { describe, expect, test } from "bun:test";
import { builtinManifests } from "@cp750/manifests";
import { type AccessPolicy, checkOperation, isRawReadLine, resolveName } from "../src/index.ts";

const manifest = builtinManifests()[0] ?? null;
const base: AccessPolicy = {
  manifest,
  verified: true,
  helpNames: null,
  allowFull: false,
  allowInternal: false,
  readOnly: false,
};

function check(policy: AccessPolicy, name: string, op: "read" | "write" | "action") {
  const target = resolveName(policy, name);
  if (!target) throw new Error(`unresolved ${name}`);
  return checkOperation(policy, target, op, {});
}

describe("policy", () => {
  test("help cross-check marks manifest params missing from help as unavailable", () => {
    const policy = { ...base, helpNames: new Set(["cp750.sys.fader"]) };
    expect(check(policy, "cp750.sys.fader", "write")).toBeNull();
    expect(check(policy, "cp750.sys.input_mode", "read")).toBe("unavailable");
  });

  test("internal names are blocked even without a spec", () => {
    const policy = { ...base, manifest: null };
    expect(check(policy, "cp750.internal.whatever", "read")).toBe("internal");
    expect(check(policy, "cp750.sys.whatever", "read")).toBeNull();
  });

  test("isRawReadLine", () => {
    expect(isRawReadLine("cp750.sys.fader ?")).toBe(true);
    expect(isRawReadLine("  CP750.SYS.FADER?  ")).toBe(true);
    expect(isRawReadLine("dump_log_100")).toBe(true);
    expect(isRawReadLine("cp750.sys.fader 70")).toBe(false);
    expect(isRawReadLine("exit")).toBe(false);
    expect(isRawReadLine("help\r\ncp750.ctrl.reboot 1")).toBe(false);
  });
});
