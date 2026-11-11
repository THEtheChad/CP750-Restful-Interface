import type { ManifestInfo } from "../../../../api/types.ts";
import { Icon } from "../../../Icon/Icon.tsx";
import styles from "./ManifestBadge.module.css";

const MATCH: Record<NonNullable<ManifestInfo>["match"], string> = {
  exact: "exact match",
  nearest: "nearest match",
  none: "no match",
};

export interface ManifestBadgeProps {
  manifest: ManifestInfo;
  /** False until `/api/device` has answered. */
  known: boolean;
}

/** The selected manifest: firmware, how it matched, and whether it is verified. */
export function ManifestBadge({ manifest, known }: ManifestBadgeProps) {
  if (!known) return <>–</>;
  if (!manifest || manifest.match === "none" || !manifest.firmware) {
    return (
      <span className={styles.unverified}>
        <Icon name="alert" /> None
      </span>
    );
  }
  return (
    <span className={styles.manifest}>
      <span className={styles.firmware}>{manifest.firmware}</span>
      <span className={styles.match}>{MATCH[manifest.match]}</span>
      {manifest.verified ? (
        <span className={styles.verified}>
          <Icon name="check" /> Verified
        </span>
      ) : (
        <span className={styles.unverified}>
          <Icon name="alert" /> {manifest.status === "draft" ? "Unverified (draft)" : "Unverified"}
        </span>
      )}
    </span>
  );
}
