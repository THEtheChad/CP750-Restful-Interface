import type { StreamStatus } from "../../../../api/context.ts";
import { useToken } from "../../../../api/hooks.ts";
import type { Device } from "../../../../api/types.ts";
import { Icon, type IconName } from "../../../Icon/Icon.tsx";
import styles from "./StatusBanners.module.css";

export interface StatusBannersProps {
  device: Device | undefined;
  gatewayError: unknown;
  stream: StreamStatus;
}

interface Banner {
  key: string;
  tone: "danger" | "warn" | "info";
  text: string;
  /** A one-line version for phones; the full `text` stays for screen readers. */
  short?: string;
}

export function bannersFor(
  device: Device | undefined,
  gatewayDown: boolean,
  hasToken: boolean,
): Banner[] {
  const out: Banner[] = [];
  if (gatewayDown) {
    out.push({
      key: "gateway",
      tone: "danger",
      text: "Can't reach the CP750 gateway. Retrying… Values on screen may be out of date.",
      short: "Gateway unreachable: values may be out of date",
    });
  }
  if (!device) return out;
  if (device.connection !== "connected") {
    const why = device.lastError ? ` (${device.lastError.message})` : "";
    out.push({
      key: "connection",
      tone: "danger",
      text:
        device.connection === "connecting"
          ? `Connecting to the processor at ${device.host}:${device.port}…`
          : `Processor offline${why}. Changes are disabled until it reconnects.`,
      short:
        device.connection === "connecting"
          ? "Connecting to the processor…"
          : "Processor offline: changes disabled",
    });
  }
  const manifest = device.manifest;
  if (device.connection === "connected" && (!manifest || manifest.match === "none")) {
    out.push({
      key: "manifest",
      tone: "warn",
      text: `No manifest matches firmware ${device.firmware ?? "(unknown)"}: values can be read, nothing can be changed.`,
      short: "No manifest: read only",
    });
  } else if (manifest && !manifest.verified) {
    const what =
      manifest.match === "nearest"
        ? `No manifest for firmware ${device.firmware ?? "?"}; using the nearest older one (${manifest.firmware}), which is unverified.`
        : `The manifest for firmware ${manifest.firmware} is an unverified draft.`;
    out.push({
      key: "manifest",
      tone: "warn",
      text: `${what} Only parameters the unit's help lists can be changed.`,
      short:
        manifest.match === "nearest"
          ? `Nearest manifest (${manifest.firmware}): help-listed parameters only`
          : "Draft manifest: help-listed parameters only",
    });
  }
  if (device.readOnly) {
    out.push({
      key: "read-only",
      tone: "info",
      text: "Read-only mode: the gateway refuses every change.",
      short: "Read-only mode",
    });
  } else if (device.authRequired && !hasToken) {
    out.push({
      key: "auth",
      tone: "info",
      text: "This gateway needs an API token for changes. Enter it under Token.",
      short: "API token needed for changes",
    });
  }
  return out;
}

const ICONS: Record<Banner["tone"], IconName> = { danger: "alert", warn: "alert", info: "info" };

/** Warnings under the status bar: gateway or processor down, unverified manifest, modes. */
export function StatusBanners({ device, gatewayError, stream }: StatusBannersProps) {
  const hasToken = useToken() !== null;
  const banners = bannersFor(device, Boolean(gatewayError) || stream === "retrying", hasToken);
  // Always rendered, so assistive tech announces banners as they appear.
  return (
    <div className={styles.banners} role="status" aria-live="polite">
      {banners.map((b) => (
        <p key={b.key} className={`${styles.banner} ${styles[b.tone]}`} data-banner={b.key}>
          <span className={styles.inner}>
            <Icon name={ICONS[b.tone]} className={styles.icon} />
            <span className={b.short ? styles.long : undefined}>{b.text}</span>
            {b.short && (
              <span className={styles.short} aria-hidden="true">
                {b.short}
              </span>
            )}
          </span>
        </p>
      ))}
    </div>
  );
}
