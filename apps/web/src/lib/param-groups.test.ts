import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eqBandOf, formatHz, SYS_GROUP_RULES, sysGroupOf } from "./param-groups.ts";

const FIRMWARE = join(import.meta.dir, "../../../../packages/manifests/firmware");

/** Every `cp750.sys.*` name in each shipped manifest. */
const manifests = readdirSync(FIRMWARE)
  .filter((f) => f.endsWith(".json"))
  .map((file) => {
    const { params } = JSON.parse(readFileSync(join(FIRMWARE, file), "utf8")) as {
      params: Record<string, unknown>;
    };
    return { file, names: Object.keys(params).filter((n) => n.startsWith("cp750.sys.")) };
  });

describe("sys groups over the shipped manifests", () => {
  test("there are manifests to check", () => {
    expect(manifests.length).toBeGreaterThanOrEqual(2);
  });

  for (const { file, names } of manifests) {
    test(`${file}: each name matches at most one rule, and few fall to Other`, () => {
      for (const name of names) {
        const suffix = name.slice("cp750.sys.".length);
        const hits = SYS_GROUP_RULES.filter((r) => r.match.test(suffix)).map((r) => r.key);
        expect({ name, hits: hits.length <= 1 ? "ok" : hits }).toEqual({ name, hits: "ok" });
      }
      const other = names.filter((n) => sysGroupOf(n)?.key === "other");
      expect(other.length).toBeLessThanOrEqual(5);
    });

    test(`${file}: every EQ param has a channel, and every band a frequency`, () => {
      for (const name of names.filter((n) => sysGroupOf(n)?.key === "eq")) {
        const band = eqBandOf(name);
        expect(band).not.toBeNull();
        if (band?.channel !== "lfe")
          expect({ name, hz: band?.hz ?? null }).not.toEqual({ name, hz: null });
      }
    });
  }
});

describe("sysGroupOf", () => {
  test("first match wins, unknown names go to Other, other namespaces aren't grouped", () => {
    expect(sysGroupOf("cp750.sys.mute")?.key).toBe("fader");
    expect(sysGroupOf("cp750.sys.input_7_8_mute")?.key).toBe("inputs");
    expect(sysGroupOf("cp750.sys.dig_1_text")?.key).toBe("inputs");
    expect(sysGroupOf("cp750.sys.theater_name")?.key).toBe("unit");
    expect(sysGroupOf("cp750.sys.bass_level_bsl")?.key).toBe("calibration");
    expect(sysGroupOf("cp750.sys.something_new")?.key).toBe("other");
    expect(sysGroupOf("cp750.state.dig_1_present")).toBeNull();
  });
});

describe("eqBandOf", () => {
  test("parses channel and centre frequency", () => {
    expect(eqBandOf("cp750.sys.eq_l_1_25k")).toEqual({ channel: "l", hz: 1250, band: "1_25k" });
    expect(eqBandOf("cp750.sys.eq_bsr_63")).toEqual({ channel: "bsr", hz: 63, band: "63" });
    expect(eqBandOf("cp750.sys.eq_rs_12_5k")?.hz).toBe(12500);
    expect(eqBandOf("cp750.sys.eq_lfe_q")).toEqual({ channel: "lfe", hz: null, band: "q" });
    expect(eqBandOf("cp750.sys.fader")).toBeNull();
    expect(formatHz(1250)).toBe("1.25 kHz");
    expect(formatHz(63)).toBe("63 Hz");
  });
});
