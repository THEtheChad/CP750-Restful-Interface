import type { Manifest } from "../src/index.ts";

export function makeManifest(
  firmware: string,
  status: Manifest["status"] = "verified",
  params: Manifest["params"] = {
    "cp750.sys.fader": {
      tier: "normal",
      access: "readwrite",
      accessSource: "inferred",
      value: { type: "integer", minimum: 0, maximum: 100 },
    },
  },
): Manifest {
  return {
    manifestVersion: 1,
    firmware,
    status,
    sources: [{ kind: "manual", ref: "test" }],
    params,
    commands: ["help"],
  };
}
