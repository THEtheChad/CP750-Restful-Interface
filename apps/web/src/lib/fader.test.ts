import { describe, expect, test } from "bun:test";
import { clampFader, formatDb, formatFader, stepFader } from "./fader.ts";

describe("fader formatting", () => {
  test("raw values read like the unit's display", () => {
    expect(formatFader(70)).toBe("7.0");
    expect(formatFader(0)).toBe("0.0");
    expect(formatFader(100)).toBe("10.0");
    expect(formatFader(65)).toBe("6.5");
    expect(formatFader(7)).toBe("0.7");
  });

  test("dB uses a sign, one decimal and a typographic minus", () => {
    expect(formatDb(0)).toBe("0.0 dB");
    expect(formatDb(-10)).toBe("−10.0 dB");
    expect(formatDb(3.33)).toBe("+3.3 dB");
    expect(formatDb(-0.04)).toBe("0.0 dB");
    expect(formatDb(undefined)).toBe("– dB");
    expect(formatDb(Number.NaN)).toBe("– dB");
  });

  test("steps are in display units and clamp to 0.0–10.0", () => {
    expect(stepFader(70, 0.1)).toBe(71);
    expect(stepFader(70, -1)).toBe(60);
    expect(stepFader(99, 1)).toBe(100);
    expect(stepFader(3, -1)).toBe(0);
    expect(clampFader(Number.NaN)).toBe(70);
    expect(clampFader(42.6)).toBe(43);
  });
});
