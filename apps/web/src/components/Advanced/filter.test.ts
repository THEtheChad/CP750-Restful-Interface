import { describe, expect, test } from "bun:test";
import { command } from "../../../test/fixtures.ts";
import { filterCommands, groupByNamespace } from "./filter.ts";

const commands = [
  command("cp750.sys.fader", { description: "Main fader" }),
  command("cp750.sys.mute", { aliases: ["mute"] }),
  command("cp750.state.dig_1_present"),
  command("cp750.ctrl.reboot", { description: "Restart the unit" }),
  command("cp750.sys_tune.eq_level"),
];

describe("advanced filter", () => {
  test("matches every word against name, aliases and description", () => {
    expect(filterCommands(commands, "MAIN fader").map((c) => c.name)).toEqual(["cp750.sys.fader"]);
    expect(filterCommands(commands, "restart").map((c) => c.name)).toEqual(["cp750.ctrl.reboot"]);
    expect(filterCommands(commands, "mute").length).toBe(1);
    expect(filterCommands(commands, "").length).toBe(commands.length);
  });

  test("filters by namespace", () => {
    expect(filterCommands(commands, "", "state").map((c) => c.name)).toEqual([
      "cp750.state.dig_1_present",
    ]);
  });

  test("groups in reading order", () => {
    expect(groupByNamespace(commands).map((g) => g.namespace)).toEqual([
      "sys",
      "sys_tune",
      "state",
      "ctrl",
    ]);
  });
});
