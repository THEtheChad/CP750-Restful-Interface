import { useDevice, useStreamStatus } from "../../api/hooks.ts";
import { AuthControl } from "./components/AuthControl/AuthControl.tsx";
import { ConnectionBadge } from "./components/ConnectionBadge/ConnectionBadge.tsx";
import { StatusBanners } from "./components/StatusBanners/StatusBanners.tsx";
import styles from "./StatusBar.module.css";

/**
 * Always-visible device state: which processor (connection + host:port), non-default modes and
 * the API token; then the banners. Firmware, manifest and modes in full are under Settings.
 */
export function StatusBar() {
  const { data: device, error } = useDevice();
  const stream = useStreamStatus();
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <h1 className="visually-hidden">CP750</h1>
        <p className={styles.summary}>
          <ConnectionBadge
            state={device?.connection}
            gatewayDown={Boolean(error) || stream === "retrying"}
          />
          <span className={styles.host}>{device ? `${device.host}:${device.port}` : "–"}</span>
        </p>
        {device && (device.readOnly || device.fullControl) && (
          <p className={styles.modes}>
            {device.readOnly && <span className={styles.chip}>Read-only</span>}
            {device.fullControl && <span className={styles.chip}>Full control</span>}
          </p>
        )}
        {device?.authRequired && (
          <div className={styles.actions}>
            <AuthControl />
          </div>
        )}
      </div>
      <StatusBanners device={device} gatewayError={error} stream={stream} />
    </header>
  );
}
