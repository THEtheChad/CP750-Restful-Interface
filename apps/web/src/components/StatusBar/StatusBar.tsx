import { useDevice, useStreamStatus } from "../../api/hooks.ts";
import { AuthControl } from "./components/AuthControl/AuthControl.tsx";
import { ConnectionBadge } from "./components/ConnectionBadge/ConnectionBadge.tsx";
import { ManifestBadge } from "./components/ManifestBadge/ManifestBadge.tsx";
import { StatusBanners } from "./components/StatusBanners/StatusBanners.tsx";
import styles from "./StatusBar.module.css";

/** Always-visible device state: connection, firmware, manifest, modes, token; then warnings. */
export function StatusBar() {
  const { data: device, error } = useDevice();
  const stream = useStreamStatus();
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <h1 className={styles.brand}>CP750</h1>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Processor</dt>
            <dd>
              <ConnectionBadge
                state={device?.connection}
                gatewayDown={Boolean(error) || stream === "retrying"}
              />
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Host</dt>
            <dd className={styles.mono}>{device ? `${device.host}:${device.port}` : "–"}</dd>
          </div>
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
            <dd className={styles.modes}>
              {device ? (
                <>
                  <span
                    className={device.readOnly ? `${styles.chip} ${styles.chipWarn}` : styles.chip}
                  >
                    {device.readOnly ? "Read-only" : "Read/write"}
                  </span>
                  <span className={styles.chip}>
                    {device.fullControl ? "Full control" : "Normal set"}
                  </span>
                </>
              ) : (
                "–"
              )}
            </dd>
          </div>
        </dl>
        {device?.authRequired && <AuthControl />}
      </div>
      <StatusBanners device={device} gatewayError={error} stream={stream} />
    </header>
  );
}
