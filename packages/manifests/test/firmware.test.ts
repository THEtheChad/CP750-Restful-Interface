import { describe, expect, test } from "bun:test";
import { compareFirmware, isFirmwareVersion } from "../src/index.ts";

describe("compareFirmware", () => {
  test.each([
    ["1.0.0.150183", "1.0.0.150183", 0],
    ["1.0.0.150183", "1.2.8.3", -1],
    ["1.2.8.3", "1.0.0.150183", 1],
    ["1.10", "1.9", 1],
    ["1.2", "1.2.0", 0],
    ["1.2", "1.2.0.1", -1],
    ["1.02", "1.2", 0],
    ["0", "0.0.0", 0],
    ["2", "1.99999999999999999999", 1],
    ["1.99999999999999999999", "1.99999999999999999998", 1],
    [" 1.2.3 ", "1.2.3", 0],
  ])("compareFirmware(%p, %p) = %p", (a, b, expected) => {
    expect(compareFirmware(a, b)).toBe(expected as -1 | 0 | 1);
  });

  test("throws on non-versions", () => {
    for (const bad of ["", "1..2", "1.2.", "v1.2", "1.2-beta", "a.b"]) {
      expect(() => compareFirmware(bad, "1.0")).toThrow(TypeError);
      expect(isFirmwareVersion(bad)).toBe(false);
    }
  });
});
