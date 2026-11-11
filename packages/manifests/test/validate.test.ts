import { describe, expect, test } from "bun:test";
import {
  assertManifest,
  builtinManifests,
  compileValueSchema,
  ManifestValidationError,
  validateManifest,
  validateValue,
} from "../src/index.ts";
import { makeManifest } from "./helpers.ts";

describe("meta-schema", () => {
  test("accepts a minimal manifest", () => {
    expect(validateManifest(makeManifest("1.0.0")).ok).toBe(true);
  });

  const fader = {
    tier: "normal",
    access: "readwrite",
    accessSource: "inferred",
    value: { type: "integer" },
  };
  /** A manifest whose only param is `spec` under `name`, typed loosely so it can be invalid. */
  function withParam(spec: Record<string, unknown>, name = "cp750.sys.fader"): unknown {
    return { ...makeManifest("1.0.0"), params: { [name]: spec } };
  }

  test.each([
    ["unknown top-level key", { ...makeManifest("1.0.0"), extra: true }],
    ["bad firmware", makeManifest("1.0.x")],
    ["missing sources", { ...makeManifest("1.0.0"), sources: [] }],
    ["uppercase param name", withParam(fader, "CP750.sys.fader")],
    ["unknown param key", withParam({ ...fader, bogus: 1 })],
    ["unsupported value schema", withParam({ ...fader, value: { type: "number" } })],
    ["unknown value schema key", withParam({ ...fader, value: { type: "integer", format: "x" } })],
    ["bad tier", withParam({ ...fader, tier: "secret" })],
    ["missing access", withParam({ ...fader, access: undefined })],
    ["empty commands", { ...makeManifest("1.0.0"), commands: [] }],
    ["destructive on a readwrite param", withParam({ ...fader, destructive: true })],
    ["a four-segment param name", withParam(fader, "cp750.sys.fader.extra")],
  ])("rejects a manifest with %s", (_label, data) => {
    const result = validateManifest(data);
    expect(result.ok).toBe(false);
    expect(() => assertManifest(data, "broken")).toThrow(ManifestValidationError);
  });

  test("rejects minimum > maximum", () => {
    const result = validateManifest(
      makeManifest("1.0.0", "verified", {
        "cp750.sys.fader": {
          tier: "normal",
          access: "readwrite",
          accessSource: "inferred",
          value: { type: "integer", minimum: 10, maximum: 0 },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("rejects an alias that collides with another param", () => {
    const spec = {
      tier: "normal",
      access: "readonly",
      accessSource: "inferred",
      value: { type: "string" },
    } as const;
    const result = validateManifest(
      makeManifest("1.0.0", "verified", {
        "cp750.sys.a": { ...spec, aliases: ["shared"] },
        "cp750.sys.b": { ...spec, aliases: ["shared"] },
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("requires internal on cp750.internal.*", () => {
    const result = validateManifest(
      makeManifest("1.0.0", "verified", {
        "cp750.internal.save_params": {
          tier: "full",
          access: "action",
          accessSource: "inferred",
          value: { type: "integer", enum: [0, 1] },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("semantic checks", () => {
  const base = { tier: "normal", access: "readwrite", accessSource: "inferred" } as const;
  function issuesFor(spec: Record<string, unknown>): string[] {
    const result = validateManifest(
      makeManifest("1.0.0", "verified", { "cp750.sys.x": spec as never }),
    );
    return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
  }

  test("integer enum members must lie within minimum/maximum", () => {
    expect(
      issuesFor({ ...base, value: { type: "integer", minimum: 0, maximum: 1, enum: [0, 1, 2] } }),
    ).toEqual(["/params/cp750.sys.x/value/enum: members outside minimum/maximum: 2"]);
    expect(issuesFor({ ...base, value: { type: "integer", minimum: 0, enum: [-1, 0] } })).toEqual([
      "/params/cp750.sys.x/value/enum: members outside minimum/maximum: -1",
    ]);
    expect(
      issuesFor({ ...base, value: { type: "integer", minimum: 0, maximum: 1, enum: [0, 1] } }),
    ).toEqual([]);
  });

  test("units only on integer values", () => {
    expect(issuesFor({ ...base, unit: "fader", value: { type: "string" } })).toEqual([
      '/params/cp750.sys.x/unit: unit "fader" needs an integer value',
    ]);
    expect(issuesFor({ ...base, unit: "ms", value: { type: "string" } })).toHaveLength(1);
    expect(issuesFor({ ...base, unit: "fader", value: { type: "integer" } })).toEqual([]);
  });

  test("destructive only on actions", () => {
    expect(
      issuesFor({ ...base, access: "readonly", destructive: true, value: { type: "integer" } }),
    ).not.toEqual([]);
    expect(issuesFor({ ...base, destructive: false, value: { type: "integer" } })).toEqual([]);
    expect(
      issuesFor({ ...base, access: "action", destructive: true, value: { type: "integer" } }),
    ).toEqual([]);
  });
});

describe("built-in manifests", () => {
  test("all validate and every value schema compiles", () => {
    const manifests = builtinManifests();
    expect(manifests.map((m) => m.firmware)).toEqual(["1.0.0.150183", "1.2.8.3"]);
    for (const manifest of manifests) {
      for (const spec of Object.values(manifest.params)) {
        expect(() => compileValueSchema(spec.value)).not.toThrow();
      }
    }
  });
});

describe("validateValue", () => {
  const fader = {
    value: { type: "integer", minimum: 0, maximum: 100 },
  } as const;
  const input = { value: { type: "string", enum: ["analog", "dig_1"] } } as const;

  test("accepts in-range values", () => {
    expect(validateValue(fader, 70)).toEqual({ ok: true });
    expect(validateValue(input, "dig_1")).toEqual({ ok: true });
  });

  test("rejects out-of-range, wrong type and non-members", () => {
    expect(validateValue(fader, 101).ok).toBe(false);
    expect(validateValue(fader, 7.5).ok).toBe(false);
    expect(validateValue(fader, "70").ok).toBe(false);
    const result = validateValue(input, "DIG_9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("dig_1");
  });

  test("x-format is an annotation", () => {
    const route = { value: { type: "string", "x-format": "route-list" } } as const;
    expect(validateValue(route, "[L R C Sw Ls Rs 7 8]")).toEqual({ ok: true });
  });
});
