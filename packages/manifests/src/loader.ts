import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { compareFirmware } from "./firmware.ts";
import { BUILTIN_MANIFEST_SOURCES } from "./generated/builtin.ts";
import type { Manifest } from "./types.ts";
import { assertManifest, type ManifestIssue, ManifestValidationError } from "./validate.ts";

let builtins: readonly Manifest[] | undefined;

/** Sorts manifests by firmware, oldest first. Returns a new array. */
export function sortManifests(manifests: readonly Manifest[]): Manifest[] {
  return [...manifests].sort((a, b) => compareFirmware(a.firmware, b.firmware));
}

/**
 * The manifests bundled with the package (static JSON imports, so `bun build --compile` embeds
 * them). Validated on first use; sorted oldest first.
 */
export function builtinManifests(): readonly Manifest[] {
  builtins ??= Object.freeze(
    sortManifests(
      Object.entries(BUILTIN_MANIFEST_SOURCES).map(([firmware, data]) =>
        assertManifest(data, `built-in ${firmware}`),
      ),
    ),
  );
  return builtins;
}

/** Reads and validates one manifest file. Its name must be `<firmware>.json`. */
export async function loadManifestFile(path: string): Promise<Manifest> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ManifestValidationError(path, [
      { path: "", message: `unreadable: ${String(error)}` },
    ]);
  }
  const manifest = assertManifest(data, path);
  const expected = `${manifest.firmware}.json`;
  if (basename(path) !== expected) {
    const issue: ManifestIssue = { path: "/firmware", message: `file must be named ${expected}` };
    throw new ManifestValidationError(path, [issue]);
  }
  return manifest;
}

/** Loads every `*.json` file in `dir` as a manifest. Any invalid file fails the whole load. */
export async function loadManifestDir(dir: string): Promise<Manifest[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => join(dir, e.name));
  return sortManifests(await Promise.all(files.map(loadManifestFile)));
}

export interface LoadManifestsOptions {
  /** Extra manifests (e.g. `CP750_MANIFEST_DIR`). A file here replaces a built-in of the same firmware. */
  dir?: string | undefined;
}

/** Built-in manifests plus those in `options.dir`, validated and sorted oldest first. */
export async function loadManifests(options: LoadManifestsOptions = {}): Promise<Manifest[]> {
  const byFirmware = new Map<string, Manifest>();
  const add = (m: Manifest) => {
    for (const key of byFirmware.keys()) {
      if (compareFirmware(key, m.firmware) === 0) byFirmware.delete(key);
    }
    byFirmware.set(m.firmware, m);
  };
  for (const m of builtinManifests()) add(m);
  if (options.dir) for (const m of await loadManifestDir(options.dir)) add(m);
  return sortManifests([...byFirmware.values()]);
}
