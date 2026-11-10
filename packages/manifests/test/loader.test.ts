import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifestDir, loadManifests, ManifestValidationError } from "../src/index.ts";
import { makeManifest } from "./helpers.ts";

describe("loadManifests", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cp750-manifests-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns the built-ins sorted when no dir is given", async () => {
    const manifests = await loadManifests();
    expect(manifests.map((m) => m.firmware)).toEqual(["1.0.0.150183", "1.2.8.3"]);
  });

  test("adds dir manifests and lets them replace a built-in", async () => {
    await writeFile(join(dir, "1.1.0.json"), JSON.stringify(makeManifest("1.1.0", "draft")));
    await writeFile(join(dir, "1.2.8.3.json"), JSON.stringify(makeManifest("1.2.8.3", "verified")));
    await writeFile(join(dir, "notes.txt"), "ignored");
    const manifests = await loadManifests({ dir });
    expect(manifests.map((m) => [m.firmware, m.status])).toEqual([
      ["1.0.0.150183", "verified"],
      ["1.1.0", "draft"],
      ["1.2.8.3", "verified"],
    ]);
  });

  test("fails on an invalid file", async () => {
    await writeFile(join(dir, "1.1.0.json"), JSON.stringify({ firmware: "1.1.0" }));
    await expect(loadManifestDir(dir)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  test("fails on unparseable JSON", async () => {
    await writeFile(join(dir, "1.1.0.json"), "{");
    await expect(loadManifestDir(dir)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  test("fails when the file name does not match the firmware", async () => {
    await writeFile(join(dir, "wrong.json"), JSON.stringify(makeManifest("1.1.0")));
    await expect(loadManifestDir(dir)).rejects.toThrow("must be named 1.1.0.json");
  });
});
