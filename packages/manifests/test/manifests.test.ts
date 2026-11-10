import { describe, expect, test } from "bun:test";
import { builtinManifests, type Manifest } from "../src/index.ts";

function manifest(firmware: string): Manifest {
  const found = builtinManifests().find((m) => m.firmware === firmware);
  if (!found) throw new Error(`missing built-in ${firmware}`);
  return found;
}

function tierCounts(m: Manifest): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of Object.values(m.params)) counts[spec.tier] = (counts[spec.tier] ?? 0) + 1;
  return counts;
}

describe("1.0.0.150183", () => {
  const m = manifest("1.0.0.150183");
  const names = Object.keys(m.params);

  test("is verified and sourced from Issue 4", () => {
    expect(m.status).toBe("verified");
    expect(m.sources[0]?.ref).toBe("Dolby 9110270 Issue 4, Tables 6-1/6-2");
  });

  test("has the expected number of params, all unique case-insensitively", () => {
    expect(names.length).toBeGreaterThanOrEqual(340);
    expect(names.length).toBeLessThanOrEqual(350);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(tierCounts(m)).toEqual({ normal: 65, full: 281 });
  });

  test("includes params the old transcription dropped or mangled", () => {
    for (const name of [
      "cp750.sys.mute",
      "cp750.sys.mute_fade_out_time",
      "cp750.sys.mute_fade_in_time",
      "cp750.sys.eq_rs_4k",
      "cp750.sys.eq_rs_400",
      "cp750.sys.speaker_distance",
      "cp750.sys.subwoofer_filter",
      "cp750.sys_tune.usb_cycle_time",
      "cp750.sys.dolby_digital_2_channel_decode_mode_1",
      "cp750.sys.dolby_digital_2_channel_decode_mode_2",
    ]) {
      expect(names).toContain(name);
    }
    expect(m.params["cp750.sys.mute_fade_out_time"]?.value).toEqual({
      type: "integer",
      minimum: 200,
      maximum: 5000,
    });
  });

  test("has 27 third-octave EQ bands for each of the 7 main channels", () => {
    for (const ch of ["l", "c", "r", "ls", "rs", "bsl", "bsr"]) {
      expect(names.filter((n) => n.startsWith(`cp750.sys.eq_${ch}_`)).length).toBe(27);
    }
  });

  test("marks safety flags", () => {
    for (const name of [
      "cp750.ctrl.reboot",
      "cp750.ctrl.default_params",
      "cp750.ctrl.log_erase",
      "cp750.internal.save_params",
    ]) {
      expect(m.params[name]?.destructive).toBe(true);
    }
    for (const [name, spec] of Object.entries(m.params)) {
      expect(spec.internal === true).toBe(name.startsWith("cp750.internal."));
    }
    expect(m.params["cp750.sysinfo.version"]?.aliases).toEqual(["version"]);
    expect(m.params["cp750.sysinfo.version"]?.tier).toBe("normal");
  });

  test("applies the inferred access defaults", () => {
    for (const [name, spec] of Object.entries(m.params)) {
      if (name.startsWith("cp750.state.") || name.startsWith("cp750.sysinfo.")) {
        expect(spec.access).toBe("readonly");
      }
      if (name.startsWith("cp750.ctrl.")) expect(spec.access).toBe("action");
    }
  });
});

describe("1.2.8.3 draft", () => {
  const base = manifest("1.0.0.150183");
  const m = manifest("1.2.8.3");

  test("is a draft", () => {
    expect(m.status).toBe("draft");
  });

  test("keeps every 1.0.0.150183 param", () => {
    for (const name of Object.keys(base.params)) expect(m.params[name]).toBeDefined();
  });

  test("adds the new decode modes to every 2-channel decode mode enum", () => {
    const decodeModes = Object.entries(m.params).filter(([n]) =>
      /_2_channel_decode_mode_\w+$|two_channel_decode_mode$/.test(n),
    );
    expect(decodeModes.length).toBe(11);
    for (const [, spec] of decodeModes) {
      expect(spec.value.type === "string" && spec.value.enum).toContain("surround_ex");
      expect(spec.value.type === "string" && spec.value.enum).toContain("4_discrete_sur");
    }
  });

  test("adds the Issue 5 params as normal tier", () => {
    for (const name of [
      "cp750.ctrl.calc_surround_delays",
      "cp750.ctrl.log_uptime",
      "cp750.sys.output_aux_source",
      "cp750.sys.output_wiring_config",
      "cp750.sys.pcm_process_mode",
      "cp750.sys.pl_surround_delay",
      "cp750.sys.serial_number",
      "cp750.sys.surround_boost",
      "cp750.sys.surround_boost_a",
      "cp750.sys.two_channel_decode_mode",
      "cp750.sys.non_sync_format",
      "cp750.sys.input_7_8_mute",
      "cp750.sys.mic_route",
      "cp750.sys.log_content",
    ]) {
      expect(m.params[name]?.tier).toBe("normal");
    }
    expect(m.params["cp750.sys.serial_number"]?.access).toBe("readonly");
  });

  test("keeps the Issue 4 delay ranges", () => {
    expect(m.params["cp750.sys.dig_1_global_delay"]?.value).toEqual(
      base.params["cp750.sys.dig_1_global_delay"]?.value,
    );
  });
});
