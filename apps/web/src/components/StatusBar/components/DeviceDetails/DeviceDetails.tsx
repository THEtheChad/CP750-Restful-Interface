import type { Device } from "../../../../api/types.ts";
import { ManifestBadge } from "../ManifestBadge/ManifestBadge.tsx";
import { ThemeSetting } from "../ThemeSetting/ThemeSetting.tsx";
import styles from "./DeviceDetails.module.css";

export interface DeviceDetailsProps {
  id: string;
  hidden: boolean;
  device: Device | undefined;
}

/** The Details disclosure: firmware, manifest, modes stated in full, and the theme. */
export function DeviceDetails({ id, hidden, device }: DeviceDetailsProps) {
  return (
    <div id={id} className={styles.details} hidden={hidden}>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Firmware</dt>
          <dd className={styles.mono}>{device?.firmware ?? "–"}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Manifest</dt>
          <dd>
            <ManifestBadge manifest={device?.manifest ?? null} known={Boolean(device)} />
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Mode</dt>
          <dd>
            {device
              ? `${device.readOnly ? "Read-only" : "Read/write"} · ${device.fullControl ? "Full control" : "Normal set"}`
              : "–"}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Theme</dt>
          <dd>
            <ThemeSetting />
          </dd>
        </div>
      </dl>
    </div>
  );
}
