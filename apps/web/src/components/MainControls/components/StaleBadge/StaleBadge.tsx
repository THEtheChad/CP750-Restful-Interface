import { useFreshness } from "../../../../api/hooks.ts";
import { Icon } from "../../../Icon/Icon.tsx";
import styles from "./StaleBadge.module.css";

/**
 * A visible "Stale" next to a main control when its value may no longer match the processor (see
 * `useFreshness`). The reason is part of the text for screen readers and a tooltip for the mouse.
 */
export function StaleBadge({ name }: { name: string }) {
  const { stale, reason } = useFreshness(name);
  if (!stale) return null;
  return (
    <span className={styles.badge} title={reason ?? undefined}>
      <Icon name="alert" />
      Stale
      {reason && <span className="visually-hidden">: {reason}</span>}
    </span>
  );
}
