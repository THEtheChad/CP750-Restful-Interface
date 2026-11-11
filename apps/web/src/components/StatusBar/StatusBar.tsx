import { useId, useState } from "react";
import { useDevice, useStreamStatus } from "../../api/hooks.ts";
import { Icon } from "../Icon/Icon.tsx";
import { AuthControl } from "./components/AuthControl/AuthControl.tsx";
import { ConnectionBadge } from "./components/ConnectionBadge/ConnectionBadge.tsx";
import { DeviceDetails } from "./components/DeviceDetails/DeviceDetails.tsx";
import { StatusBanners } from "./components/StatusBanners/StatusBanners.tsx";
import styles from "./StatusBar.module.css";

/**
 * The ink shell: which processor (connection + host:port, always visible), non-default modes, a
 * Details disclosure (firmware, manifest, modes in full, theme) and the token; then the banners.
 */
export function StatusBar() {
  const { data: device, error } = useDevice();
  const stream = useStreamStatus();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <h1 className={styles.brand}>CP750</h1>
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
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((o) => !o)}
          >
            Details
            <Icon name="chevron" className={styles.chevron} />
          </button>
          {device?.authRequired && <AuthControl />}
        </div>
      </div>
      <DeviceDetails id={detailsId} hidden={!open} device={device} />
      <StatusBanners device={device} gatewayError={error} stream={stream} />
    </header>
  );
}
