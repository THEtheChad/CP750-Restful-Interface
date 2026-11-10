import { describe, expect, test } from "bun:test";
import { dbToFader, faderToDb } from "../src/index.ts";

describe("fader curve", () => {
  test.each([
    [0, -90],
    [20, -50],
    [40, -10],
    [70, 0],
    [100, 10],
  ])("raw %p is %p dB", (raw, db) => {
    expect(faderToDb(raw)).toBe(db);
    expect(dbToFader(db)).toBe(raw);
  });

  test("upper segment is about 3.33 dB per display unit", () => {
    expect(faderToDb(80)).toBeCloseTo(3.33, 2);
  });

  test("round-trips every raw value", () => {
    for (let raw = 0; raw <= 100; raw++) expect(dbToFader(faderToDb(raw))).toBe(raw);
  });

  test("clamps out-of-range input", () => {
    expect(faderToDb(-5)).toBe(-90);
    expect(faderToDb(150)).toBe(10);
    expect(dbToFader(-200)).toBe(0);
    expect(dbToFader(20)).toBe(100);
  });
});
