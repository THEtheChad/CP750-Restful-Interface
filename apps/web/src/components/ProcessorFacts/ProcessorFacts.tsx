import { useDevice, useParamAccess, useStreamStatus } from "../../api/hooks.ts";
import { ConnectionBadge } from "../StatusBar/components/ConnectionBadge/ConnectionBadge.tsx";
import { ManifestBadge } from "./components/ManifestBadge/ManifestBadge.tsx";
import styles from "./ProcessorFacts.module.css";

const METERS_PARAM = "cp750.state.meters";

/**
 * Facts about the processor, only the ones we have: connection, host, firmware, manifest, modes
 * stated in full, and whether meters can be read (they are full-tier, format still unverified).
 */
export function ProcessorFacts() {
  const { data: device, error } = useDevice();
  const stream = useStreamStatus();
  const meters = useParamAccess(METERS_PARAM);
  return (
    <dl className={styles.facts}>
      <div className={styles.fact}>
        <dt>Connection</dt>
        <dd>
          <ConnectionBadge
            state={device?.connection}
            gatewayDown={Boolean(error) || stream === "retrying"}
          />
        </dd>
      </div>
      <div className={styles.fact}>
        <dt>Host</dt>
        <dd className={styles.figures}>{device ? `${device.host}:${device.port}` : "–"}</dd>
      </div>
      <div className={styles.fact}>
        <dt>Firmware</dt>
        <dd className={styles.figures}>{device?.firmware ?? "–"}</dd>
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
        <dt>Meters</dt>
        <dd className={styles.quiet}>
          {!device
            ? "–"
            : meters.read === null
              ? "Readable; the format isn't verified yet, so they aren't drawn"
              : "Unavailable: they need the full command set"}
        </dd>
      </div>
    </dl>
  );
}
