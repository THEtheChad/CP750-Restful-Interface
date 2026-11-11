import type { ConnectionState } from "../../../../api/types.ts";
import styles from "./ConnectionBadge.module.css";

const LABELS: Record<ConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  idle: "Not connected",
  closed: "Disconnected",
};

export interface ConnectionBadgeProps {
  state: ConnectionState | undefined;
  /** The gateway itself is unreachable. */
  gatewayDown: boolean;
}

/** Connection state as colour, shape and words (never colour alone). */
export function ConnectionBadge({ state, gatewayDown }: ConnectionBadgeProps) {
  const label = gatewayDown ? "Gateway unreachable" : state ? LABELS[state] : "Loading…";
  const tone =
    !gatewayDown && state === "connected"
      ? styles.ok
      : !gatewayDown && (state === "connecting" || state === "reconnecting" || !state)
        ? styles.pending
        : styles.down;
  return (
    <span className={`${styles.badge} ${tone}`}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}
