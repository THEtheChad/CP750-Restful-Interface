import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isFirmwareVersion } from "@cp750/manifests";
import type { CaptureResult } from "./session-factory.ts";

export interface CaptureFiles {
  dir: string;
  help: string;
  status: string;
  manifest: string;
}

function lines(values: readonly string[]): string {
  return values.length === 0 ? "" : `${values.join("\n")}\n`;
}

/** Writes `<outDir>/<firmware>/{help.txt,status.txt,manifest.json}` and returns the paths. */
export async function writeCapture(outDir: string, capture: CaptureResult): Promise<CaptureFiles> {
  // The firmware string becomes a directory name, so it must be digits and dots only.
  if (!isFirmwareVersion(capture.firmware)) {
    throw new Error(
      `The unit reported an unexpected firmware string: ${JSON.stringify(capture.firmware)}`,
    );
  }
  const dir = join(outDir, capture.firmware.trim());
  await mkdir(dir, { recursive: true });
  const files: CaptureFiles = {
    dir,
    help: join(dir, "help.txt"),
    status: join(dir, "status.txt"),
    manifest: join(dir, "manifest.json"),
  };
  await writeFile(files.help, lines(capture.help));
  await writeFile(files.status, lines(capture.status));
  await writeFile(files.manifest, `${JSON.stringify(capture.draftManifest, null, 2)}\n`);
  return files;
}
