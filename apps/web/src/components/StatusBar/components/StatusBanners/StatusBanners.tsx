import type { StreamStatus } from "../../../../api/context.ts";
import { useToken } from "../../../../api/hooks.ts";
import type { Device } from "../../../../api/types.ts";
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
    });
  }
  const manifest = device.manifest;
  if (device.connection === "connected" && (!manifest || manifest.match === "none")) {
    out.push({
      key: "manifest",
      tone: "warn",
      text: `No manifest matches firmware ${device.firmware ?? "(unknown)"}: values can be read, nothing can be changed.`,
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
    });
  }
  if (device.readOnly) {
    out.push({
      key: "read-only",
      tone: "info",
      text: "Read-only mode: the gateway refuses every change.",
    });
  } else if (device.authRequired && !hasToken) {
    out.push({
      key: "auth",
      tone: "info",
      text: "This gateway needs an API token for changes. Enter it under Token.",
    });
  }
  return out;
}

/** Warnings under the status bar: gateway or processor down, unverified manifest, modes. */
export function StatusBanners({ device, gatewayError, stream }: StatusBannersProps) {
  const hasToken = useToken() !== null;
  const banners = bannersFor(device, Boolean(gatewayError) || stream === "retrying", hasToken);
  // Always rendered, so assistive tech announces banners as they appear.
  return (
    <div className={styles.banners} role="status" aria-live="polite">
      {banners.map((b) => (
        <p key={b.key} className={`${styles.banner} ${styles[b.tone]}`} data-banner={b.key}>
          <span>
            {b.tone === "danger" ? "⚠ " : ""}
            {b.text}
          </span>
        </p>
      ))}
    </div>
  );
}
