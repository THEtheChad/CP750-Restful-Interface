import { compareFirmware, isFirmwareVersion } from "./firmware.ts";
import type { Manifest } from "./types.ts";

export type ManifestMatch = "exact" | "nearest" | "none";

export interface ManifestSelection {
  manifest: Manifest | null;
  match: ManifestMatch;
  /** True only for an exact match with a `verified` manifest. */
  verified: boolean;
}

/**
 * Picks the manifest for a unit's firmware (docs/ARCHITECTURE.md, "Session"):
 * an exact match (verified or draft), else the highest known firmware below the unit's
 * (`nearest`, never verified), else `none`. An unparseable firmware string gives `none`.
 */
export function selectManifest(
  firmware: string,
  manifests: readonly Manifest[],
): ManifestSelection {
  if (!isFirmwareVersion(firmware)) return { manifest: null, match: "none", verified: false };

  const exact = manifests.find((m) => compareFirmware(m.firmware, firmware) === 0);
  if (exact) {
    return { manifest: exact, match: "exact", verified: exact.status === "verified" };
  }

  let nearest: Manifest | null = null;
  for (const candidate of manifests) {
    if (compareFirmware(candidate.firmware, firmware) > 0) continue;
    if (!nearest || compareFirmware(candidate.firmware, nearest.firmware) > 0) nearest = candidate;
  }
  return nearest
    ? { manifest: nearest, match: "nearest", verified: false }
    : { manifest: null, match: "none", verified: false };
}
