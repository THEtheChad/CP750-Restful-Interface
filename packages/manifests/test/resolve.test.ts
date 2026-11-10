import { describe, expect, test } from "bun:test";
import { builtinManifests, findParam, resolveParamName } from "../src/index.ts";

describe("name resolution", () => {
  const m = builtinManifests()[0];
  if (!m) throw new Error("no built-ins");

  test("resolves names and aliases case-insensitively", () => {
    expect(resolveParamName(m, "cp750.sys.fader")).toBe("cp750.sys.fader");
    expect(resolveParamName(m, " CP750.SYS.Fader ")).toBe("cp750.sys.fader");
    expect(resolveParamName(m, "version")).toBe("cp750.sysinfo.version");
    expect(resolveParamName(m, "VERSION")).toBe("cp750.sysinfo.version");
  });

  test("returns null for unknown names", () => {
    expect(resolveParamName(m, "cp750.sys.nope")).toBeNull();
    expect(findParam(m, "fader")).toBeNull();
  });

  test("findParam returns the spec", () => {
    expect(findParam(m, "Version")?.spec.access).toBe("readonly");
  });
});
