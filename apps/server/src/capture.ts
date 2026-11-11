/**
 * Writes what `cp750 capture` recorded (docs/ADDING-A-FIRMWARE.md):
 *
 *   <outDir>/<firmware>.json            the draft manifest (so <outDir> works as CP750_MANIFEST_DIR)
 *   <outDir>/<firmware>/version.txt     the raw version reply line
 *   <outDir>/<firmware>/help.txt        `help`, normal command set
 *   <outDir>/<firmware>/status.txt      `status`, normal command set
 *   <outDir>/<firmware>/help-full.txt   `help` with full_ascii_ctrl 1 (when the unit allowed it)
 *   <outDir>/<firmware>/status-full.txt `status` with full_ascii_ctrl 1 (when the unit allowed it)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isFirmwareVersion } from "@cp750/manifests";
import type { CaptureResult } from "./session-factory.ts";

export interface CaptureFiles {
  /** The directory holding the raw text files. */
  dir: string;
  version: string;
  help: string;
  status: string;
  /** `null` when the unit refused full control, so there was nothing to record. */
  helpFull: string | null;
  statusFull: string | null;
  /** `<outDir>/<firmware>.json`. */
  manifest: string;
}

function lines(values: readonly string[]): string {
  return values.length === 0 ? "" : `${values.join("\n")}\n`;
}

/** Writes the capture under `outDir` and returns the paths. */
export async function writeCapture(outDir: string, capture: CaptureResult): Promise<CaptureFiles> {
  // The firmware string becomes a file and directory name, so it must be digits and dots only.
  if (!isFirmwareVersion(capture.firmware)) {
    throw new Error(
      `The unit reported an unexpected firmware string: ${JSON.stringify(capture.firmware)}`,
    );
  }
  const firmware = capture.firmware.trim();
  const dir = join(outDir, firmware);
  await mkdir(dir, { recursive: true });
  const files: CaptureFiles = {
    dir,
    version: join(dir, "version.txt"),
    help: join(dir, "help.txt"),
    status: join(dir, "status.txt"),
    helpFull: capture.helpFull ? join(dir, "help-full.txt") : null,
    statusFull: capture.statusFull ? join(dir, "status-full.txt") : null,
    manifest: join(outDir, `${firmware}.json`),
  };
  await writeFile(files.version, `${capture.versionLine}\n`);
  await writeFile(files.help, lines(capture.help));
  await writeFile(files.status, lines(capture.status));
  if (files.helpFull && capture.helpFull) await writeFile(files.helpFull, lines(capture.helpFull));
  if (files.statusFull && capture.statusFull) {
    await writeFile(files.statusFull, lines(capture.statusFull));
  }
  await writeFile(files.manifest, `${JSON.stringify(capture.draftManifest, null, 2)}\n`);
  return files;
}
