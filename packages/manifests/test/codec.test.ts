import { describe, expect, test } from "bun:test";
import {
  builtinManifests,
  decode,
  encode,
  type ParamSpec,
  ValueCodecError,
  valuesEqual,
} from "../src/index.ts";

const params = builtinManifests()[0]?.params ?? {};
function spec(name: string): ParamSpec {
  const found = params[name];
  if (!found) throw new Error(name);
  return found;
}

describe("codec", () => {
  test("round-trips every enum member and the range ends of every built-in param", () => {
    for (const manifest of builtinManifests()) {
      for (const p of Object.values(manifest.params)) {
        const v = p.value;
        const samples =
          v.type === "integer"
            ? (v.enum ?? [v.minimum ?? 0, v.maximum ?? 0])
            : (v.enum ?? ["some text"]);
        for (const sample of samples) expect(decode(p, encode(p, sample))).toEqual(sample);
      }
    }
  });

  test("encodes integers as decimal", () => {
    expect(encode(spec("cp750.sys.fader"), 70)).toBe("70");
    expect(encode(spec("cp750.sys.level_c"), -160)).toBe("-160");
  });

  test("decodes the unit's casing, whitespace and NULs", () => {
    expect(decode(spec("cp750.sys.fader"), " 70\u0000\r")).toBe(70);
    expect(decode(spec("cp750.sys.fader"), "+5")).toBe(5);
    expect(decode(spec("cp750.sys.input_mode"), "  DIG_1 ")).toBe("dig_1");
    expect(decode(spec("cp750.state.bitstream_format"), "dolby_digital")).toBe("Dolby_Digital");
    expect(decode(spec("cp750.sys.analog_route"), "[ L  R C Sw Ls Rs 7 8 ]")).toBe(
      "[L R C Sw Ls Rs 7 8]",
    );
    expect(decode(spec("cp750.sys.theater_name"), "  Screen 1 ")).toBe("Screen 1");
  });

  test("returns unknown enum values as-is rather than guessing", () => {
    expect(decode(spec("cp750.sys.input_mode"), "dig_9")).toBe("dig_9");
  });

  test("rejects non-integer replies for integer params", () => {
    expect(() => decode(spec("cp750.sys.fader"), "n_a")).toThrow(ValueCodecError);
    expect(() => decode(spec("cp750.sys.fader"), "")).toThrow(ValueCodecError);
  });

  test("refuses values that would change the command line", () => {
    const text = spec("cp750.sys.theater_name");
    for (const bad of ["a\r\ncp750.ctrl.reboot 1", "", " ", "?", " padded"]) {
      expect(() => encode(text, bad)).toThrow(ValueCodecError);
    }
    expect(() => encode(spec("cp750.sys.fader"), 7.5)).toThrow(ValueCodecError);
    expect(() => encode(spec("cp750.sys.fader"), "70")).toThrow(ValueCodecError);
    expect(() => encode(text, 7)).toThrow(ValueCodecError);
  });

  test("valuesEqual compares like the unit", () => {
    expect(valuesEqual(spec("cp750.sys.input_mode"), "dig_1", "DIG_1")).toBe(true);
    expect(valuesEqual(spec("cp750.sys.analog_route"), "[L R]", "[ l r ]")).toBe(true);
    expect(valuesEqual(spec("cp750.sys.fader"), 70, 71)).toBe(false);
    expect(valuesEqual(spec("cp750.sys.fader"), 70, "70")).toBe(false);
  });
});
