import { describe, expect, test } from "bun:test";
import { controlFor, namespaceOf, parseInput, SLIDER_MAX_SPAN } from "./schema-control.ts";

describe("schema → control mapping", () => {
  test("0/1 integer enums are switches, in either order", () => {
    expect(controlFor({ type: "integer", enum: [0, 1] })).toEqual({ kind: "switch" });
    expect(controlFor({ type: "integer", enum: [1, 0] })).toEqual({ kind: "switch" });
  });

  test("other enums are selects that keep the value type", () => {
    expect(controlFor({ type: "integer", enum: [0, 1, 2] })).toEqual({
      kind: "select",
      options: [0, 1, 2],
      valueType: "integer",
    });
    expect(controlFor({ type: "string", enum: ["analog", "dig_1"] })).toEqual({
      kind: "select",
      options: ["analog", "dig_1"],
      valueType: "string",
    });
  });

  test("small integer ranges get a slider, large or open ones a number input", () => {
    expect(controlFor({ type: "integer", minimum: -60, maximum: 60 })).toEqual({
      kind: "range",
      min: -60,
      max: 60,
    });
    expect(controlFor({ type: "integer", minimum: 0, maximum: SLIDER_MAX_SPAN })).toEqual({
      kind: "range",
      min: 0,
      max: SLIDER_MAX_SPAN,
    });
    expect(controlFor({ type: "integer", minimum: 200, maximum: 5000 })).toEqual({
      kind: "number",
      min: 200,
      max: 5000,
    });
    expect(controlFor({ type: "integer", minimum: 0 })).toEqual({ kind: "number", min: 0 });
  });

  test("strings are text fields with their limits; no schema means no control", () => {
    expect(controlFor({ type: "string" })).toEqual({ kind: "text" });
    expect(controlFor({ type: "string", maxLength: 16, "x-format": "route-list" })).toEqual({
      kind: "text",
      maxLength: 16,
      format: "route-list",
    });
    expect(controlFor(null)).toEqual({ kind: "none" });
  });
});

describe("input parsing", () => {
  test("integers are validated against the range and enum", () => {
    const range = { type: "integer" as const, minimum: -60, maximum: 60 };
    expect(parseInput(range, " 12 ")).toEqual({ ok: true, value: 12 });
    expect(parseInput(range, "−5")).toEqual({ ok: true, value: -5 });
    expect(parseInput(range, "61")).toEqual({ ok: false, error: "Must be 60 or less" });
    expect(parseInput(range, "1.5")).toEqual({ ok: false, error: "Enter a whole number" });
    expect(parseInput({ type: "integer", enum: [0, 1] }, "2").ok).toBe(false);
  });

  test("strings respect maxLength and enum", () => {
    expect(parseInput({ type: "string", maxLength: 3 }, "abcd").ok).toBe(false);
    expect(parseInput({ type: "string", enum: ["on", "off"] }, "on")).toEqual({
      ok: true,
      value: "on",
    });
  });

  test("namespaces come from the second name segment", () => {
    expect(namespaceOf("cp750.sys_tune.x")).toBe("sys_tune");
    expect(namespaceOf("cp750.ctrl.reboot")).toBe("ctrl");
    expect(namespaceOf("weird")).toBe("other");
  });
});
