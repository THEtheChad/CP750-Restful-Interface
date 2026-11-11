import { describe, expect, test } from "bun:test";
import {
  functionOf,
  MUTE_VOCABULARY,
  ON_OFF_VOCABULARY,
  SEGMENT_MAX_OPTIONS,
  toggleState,
} from "./param-function.ts";

const int = (minimum: number, maximum: number) => ({ type: "integer" as const, minimum, maximum });

describe("functionOf", () => {
  test("every fader-unit param is a level, never a free-form slider", () => {
    for (const name of [
      "cp750.sys.fader",
      "cp750.sys.fader_preset_1",
      "cp750.sys.fader_preset_m",
    ]) {
      expect(functionOf({ name, unit: "fader", schema: int(0, 100) })).toEqual({ kind: "level" });
    }
  });

  test("0/1 params are toggles; main mute speaks mute", () => {
    const schema = { type: "integer" as const, enum: [0, 1] };
    expect(functionOf({ name: "cp750.sys.mute", unit: null, schema })).toEqual({
      kind: "toggle",
      vocabulary: MUTE_VOCABULARY,
    });
    expect(functionOf({ name: "cp750.sys.pcm_2_0", unit: null, schema })).toEqual({
      kind: "toggle",
      vocabulary: ON_OFF_VOCABULARY,
    });
  });

  test("enums that fit on one line are segments; longer ones a list", () => {
    const choice = (name: string, options: string[]) =>
      functionOf({ name, unit: null, schema: { type: "string", enum: options } });
    expect(choice("cp750.sys.distance_units", ["feet", "meters"])).toEqual({
      kind: "choice",
      options: ["feet", "meters"],
      layout: "segments",
    });
    expect(choice("x", ["minimum_latency", "mute", "silent_switch"])).toMatchObject({
      layout: "segments",
    });
    const inputs = ["analog", "dig_1", "dig_2", "dig_3", "dig_4", "last", "mic", "non_sync"];
    expect(choice("cp750.sys.input_mode", inputs)).toMatchObject({ layout: "list" });
    const many = Array.from({ length: SEGMENT_MAX_OPTIONS + 1 }, (_, i) => `m${i}`);
    expect(choice("x", many)).toMatchObject({ layout: "list" });
  });

  test("numbers, ranges and text are entries; no schema is none", () => {
    expect(functionOf({ name: "x", unit: "ms", schema: int(0, 300) })).toEqual({ kind: "entry" });
    expect(functionOf({ name: "x", unit: null, schema: { type: "string" } })).toEqual({
      kind: "entry",
    });
    expect(functionOf({ name: "x", unit: null, schema: null })).toEqual({ kind: "none" });
  });
});

describe("toggleState", () => {
  test("confirmed, pending and unknown", () => {
    expect(toggleState(1, false, MUTE_VOCABULARY)).toMatchObject({ tone: "on", word: "Muted" });
    expect(toggleState(0, false, MUTE_VOCABULARY)).toMatchObject({ tone: "off", word: "Audio on" });
    expect(toggleState(1, true, MUTE_VOCABULARY)).toMatchObject({
      tone: "pending",
      word: "Muting…",
    });
    expect(toggleState(0, true, ON_OFF_VOCABULARY)).toMatchObject({ word: "Turning off…" });
    expect(toggleState(undefined, false, ON_OFF_VOCABULARY)).toMatchObject({
      known: false,
      tone: undefined,
      word: "Unknown",
    });
  });
});
